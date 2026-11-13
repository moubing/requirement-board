import { and, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import type { Transaction } from '../db/client'
import { assets, requirementCollaborationDocuments, requirementRevisions, requirements, requirementStatuses } from '../db/schema'
import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { emptyAttribution } from '../../shared/collaboration/attribution'
import { ensureBlockIds, extractPlainText, type RichTextDocument } from '../../shared/editor/document'
import { draftDocumentSchema } from '../../shared/drafts/validation'
import { richTextProseMirrorSchema } from '../../shared/editor/validation'
import type { RequirementPropertyPatch } from '../../shared/requirements/properties'
import { normalizeAssignments, validateProperties } from './requirement-properties'
import { replaceDocumentAssignees } from './document-assignees'
import { initialDocumentState, type DocumentType } from '../../shared/documents/workflow'
import { assertDraftImages } from './requirement-drafts'
import { lockAssetReferences } from './asset-references'
import { initializeMilestoneCoverage } from './requirement-milestones'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'

export function normalizeCreationContent(content: RichTextDocument) {
  const checked = draftDocumentSchema.safeParse(ensureBlockIds(structuredClone(content)))
  if (!checked.success) throw createError({ statusCode: 422, message: '新建正文格式无效', data: { code: 'INVALID_INPUT', issues: checked.error.issues } })
  return normalizeTrailingParagraph(richTextProseMirrorSchema.nodeFromJSON(checked.data).toJSON() as RichTextDocument)
}

export async function resolveCreationProperties(tx: Transaction, projectId: string, patch: RequirementPropertyPatch, documentType: DocumentType = 'requirement') {
  const status = patch.statusId ?? (await tx.query.requirementStatuses.findFirst({ where: and(eq(requirementStatuses.projectId, projectId), eq(requirementStatuses.code, initialDocumentState(documentType))) }))?.id
  if (!status) throw createError({ statusCode: 400, message: '项目没有可用状态' })
  const assignments = normalizeAssignments(patch)
  const properties = { statusId: status, assigneeIds: assignments.assigneeIds ?? [], priority: patch.priority ?? 'medium' as const }
  await validateProperties(tx, projectId, properties, { documentType })
  return properties
}

/** 新建时一次写入完整 v1 和初始 Yjs，后续编辑永远沿用该 Yjs 历史。 */
export async function createRequirement(tx: Transaction, projectId: string, userId: string,
  input: { title: string; documentType?: DocumentType; contentJson: RichTextDocument; properties?: RequirementPropertyPatch; changeNote: string; initializeCollaboration?: boolean; agentRequestId?: string }) {
  await lockAssetReferences(tx)
  const properties = await resolveCreationProperties(tx, projectId, input.properties ?? {}, input.documentType)
  const contentJson = normalizeCreationContent(input.contentJson)
  const stagedIds = await assertDraftImages(tx, contentJson, projectId, input.agentRequestId ? { userId, requestId: input.agentRequestId, frozen: true } : undefined)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('requirement-number', 0))`)
  const [number] = await tx.select({ value: sql<number>`coalesce(max(substring(${requirements.key} from '^REQ-([0-9]+)$')::bigint), 0)::int + 1` }).from(requirements)
  const requirementId = `req_${nanoid(12)}`, revisionId = `rev_${nanoid(12)}`
  const document = createCollaborationDocument({ title: input.title, contentJson })
  try {
    const snapshot = readCollaborationDocument(document)
    const { assigneeIds, ...metadata } = properties
    const [row] = await tx.insert(requirements).values({ id: requirementId, projectId, documentType: input.documentType, key: `REQ-${number!.value}`, title: input.title, reporterId: userId, ...metadata }).returning()
    await replaceDocumentAssignees(tx, requirementId, assigneeIds)
    await initializeMilestoneCoverage(tx, row!, properties, input.agentRequestId ? 'agent_takeover' : 'web', input.agentRequestId ?? `create_${requirementId}`)
    if (stagedIds.length) await tx.update(assets).set({ requirementId }).where(inArray(assets.id, stagedIds))
    await tx.insert(requirementRevisions).values({ id: revisionId, requirementId, version: 1, ...snapshot,
      contentText: extractPlainText(snapshot.contentJson), changeNote: input.changeNote, authorId: userId })
    if (input.initializeCollaboration !== false) await tx.insert(requirementCollaborationDocuments).values({ requirementId, ...snapshot, state: Y.encodeStateAsUpdate(document),
      attribution: emptyAttribution({ id: revisionId, version: 1 }) })
    return { requirementId, revisionId }
  } finally { document.destroy() }
}
