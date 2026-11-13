import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { Doc } from 'yjs'
import { readCollaborationDocument } from '../../../../shared/collaboration/document'
import { addNodeContributors, changedAttributionNodes, emptyAttribution } from '../../../../shared/collaboration/attribution'
import { currentNodeContributions, revisionNodeContributions } from '../../../services/node-contributions'

import {
  ensureBlockIds,
  extractPlainText,
  isEmptyParagraphNode,
} from '../../../../shared/editor/document'
import { richTextDocumentSchema } from '../../../../shared/editor/validation'
import { bumpUpdatedAt, requirementCollaborationDocuments, requirementRevisions, requirements } from '../../../db/schema'
import { requireAppContext } from '../../../utils/request-context'
import { draftIdSchema } from '../../../../shared/drafts/validation'
import { lockAssetReferences } from '../../../services/asset-references'
import { finishDraft, lockDraft, ownedDraft } from '../../../services/requirement-drafts'
import { broadcastSavedRevision, requireDocumentSchema, staleEditEpoch, withCollaborativeDocument } from '../../../services/collaboration'
import { assertRequirementUnlocked } from '../../../services/agent-locks'
import { needsTrailingParagraph, normalizeTrailingParagraph } from '../../../../shared/editor/trailing-paragraph'

const revisionSchema = z.object({
  schemaVersion: z.number().int().optional(),
  schemaCapabilities: z.array(z.string().max(64)).max(20).optional(),
  editEpoch: z.number().int().nonnegative().default(0),
  // 兼容旧客户端的请求字段；保存版本不再修改文档标题。
  title: z.string().trim().min(1).max(240).optional(),
  contentJson: richTextDocumentSchema,
  changeNote: z.string().trim().max(500).default(''),
  draftId: draftIdSchema.optional(),
  clientSaveId: draftIdSchema.optional(),
  collaborationUpdate: z.string().min(1).max(24 * 1024 * 1024).optional(),
}).refine(value => !value.draftId || Boolean(value.clientSaveId))

export default defineEventHandler(async (event) => {
  const requirementId = getRouterParam(event, 'id')
  if (!requirementId) throw createError({ statusCode: 400, statusMessage: 'Missing requirement id' })

  const { db, currentUserId, projectId } = await requireAppContext(event)
  const parsedBody = revisionSchema.safeParse(await readBody(event))
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsedBody.error.issues[0]?.message ?? 'Invalid revision content',
    })
  }
  const body = parsedBody.data
  // 必须在合并 collaborationUpdate 前拒绝旧页面，不能先污染内存中的共同草稿。
  requireDocumentSchema(body.schemaVersion ?? Number(getHeader(event, 'x-rb-document-schema') ?? 0),
    body.schemaCapabilities ?? getHeader(event, 'x-rb-document-capabilities')?.split(',') ?? [])
  const requirement = await db.query.requirements.findFirst({
    where: (table, { and, eq }) => and(
      eq(table.id, requirementId),
      eq(table.projectId, projectId),
    ),
  })

  if (!requirement) {
    throw createError({ statusCode: 404, statusMessage: 'Requirement not found' })
  }

  const requestContentJson = ensureBlockIds(body.contentJson)
  const save = (document?: Doc) => db.transaction(async (tx) => {
    await lockAssetReferences(tx)
    const [currentRequirement] = await tx.select().from(requirements).where(eq(requirements.id, requirementId)).for('update')
    if (body.clientSaveId) {
      const previous = await tx.query.requirementRevisions.findFirst({ where: and(eq(requirementRevisions.authorId, currentUserId), eq(requirementRevisions.clientSaveId, body.clientSaveId)) })
      if (previous) {
        // 原请求重试时只排除本次保存自动追加的尾段，原正文和块 ID 仍须完全相同。
        const savedContent = needsTrailingParagraph(requestContentJson) && isEmptyParagraphNode(previous.contentJson.content.at(-1))
          ? { ...previous.contentJson, content: previous.contentJson.content.slice(0, -1) }
          : previous.contentJson
        if (previous.requirementId !== requirementId || previous.changeNote !== body.changeNote || (!body.collaborationUpdate && !isDeepStrictEqual(savedContent, requestContentJson))) {
          throw createError({ statusCode: 409, message: '保存请求内容已改变，请使用新的保存请求' })
        }
        return previous.id
      }
    }
    await assertRequirementUnlocked(tx, requirementId)
    const latest = await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, requirementId), orderBy: desc(requirementRevisions.version) })
    let draft
    if (body.draftId) {
      await lockDraft(tx, body.draftId)
      draft = await ownedDraft(tx, body.draftId, requirementId, currentUserId)
      if (!draft) throw createError({ statusCode: 400, message: '草稿不存在，请重新同步后保存' })
      if (draft.pendingUploads.length) throw createError({ statusCode: 400, message: '请等待图片上传完成后再保存版本' })
    }
    // 取得需求行锁后再捕获共同文档，使排队保存的后一个版本包含此前已同步的更新。
    const snapshot = revisionSchema.safeParse({ ...body, ...(document ? readCollaborationDocument(document) : {}), title: currentRequirement!.title })
    if (!snapshot.success) throw createError({ statusCode: 400, message: '请检查共同文档的标题和内容后再保存' })
    const contentJson = normalizeTrailingParagraph(ensureBlockIds(snapshot.data.contentJson))
    const contentText = extractPlainText(contentJson)
    const id = `rev_${nanoid(12)}`
    const [collaboration] = await tx.select().from(requirementCollaborationDocuments)
      .where(eq(requirementCollaborationDocuments.requirementId, requirementId)).for('update')
    if (collaboration && (collaboration.editEpoch !== body.editEpoch || (collaboration.editEpoch > 0 && !document))) throw staleEditEpoch()
    const attribution = document && collaboration ? addNodeContributors(await currentNodeContributions(tx, collaboration),
      changedAttributionNodes(collaboration, { title: currentRequirement!.title, contentJson }), null) : null
    await tx.insert(requirementRevisions).values({
      id,
      requirementId,
      version: (latest?.version ?? 0) + 1,
      title: currentRequirement!.title,
      contentJson,
      contentText,
      changeNote: body.changeNote,
      authorId: currentUserId,
      clientSaveId: body.clientSaveId,
      attribution,
      attributionSequence: collaboration?.attributionSequence ?? null,
    })

    // 版本快照与下一版名单的分界在同一事务中完成；重试已保存请求不会再次清空名单。
    if (document && collaboration) await tx.update(requirementCollaborationDocuments)
      .set({ attribution: emptyAttribution({ id, version: (latest?.version ?? 0) + 1 }) })
      .where(eq(requirementCollaborationDocuments.requirementId, requirementId))

    await tx
      .update(requirements)
      .set({
        ...bumpUpdatedAt,
      })
      .where(and(eq(requirements.id, requirementId), eq(requirements.projectId, projectId)))
    if (draft && !draft.closedAt) await finishDraft(tx, draft)
    return id
  })

  const revisionId = body.collaborationUpdate
    ? await withCollaborativeDocument(requirementId, new Uint8Array(Buffer.from(body.collaborationUpdate, 'base64')), save, body.editEpoch)
    : await save()

  await broadcastSavedRevision(requirementId, revisionId, body.clientSaveId)
  const revision = await db.query.requirementRevisions.findFirst({
    where: eq(requirementRevisions.id, revisionId),
    with: { author: true },
  })
  return revision ? revisionNodeContributions(db, revision) : revision
})
