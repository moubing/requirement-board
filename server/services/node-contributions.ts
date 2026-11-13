import { and, asc, desc, eq, gt, lte } from 'drizzle-orm'
import { attributionFromReceipts, isAttributionSnapshot } from '../../shared/collaboration/attribution'
import { richTextProseMirrorSchema } from '../../shared/editor/validation'
import type { RichTextDocument } from '../../shared/editor/document'
import type { Database, Transaction } from '../db/client'
import { requirementCollaborationDocuments, requirementEditEvents, requirementRevisions } from '../db/schema'

type Db = Database | Transaction
type Revision = typeof requirementRevisions.$inferSelect
type Collaboration = typeof requirementCollaborationDocuments.$inferSelect

function normalizedRevision(revision?: Revision) {
  return revision ? { ...revision, contentJson: richTextProseMirrorSchema.nodeFromJSON(revision.contentJson).toJSON() as RichTextDocument } : null
}

async function receipts(db: Db, requirementId: string, after: number, until: number) {
  return db.select({ authorId: requirementEditEvents.authorId, authorName: requirementEditEvents.authorName,
    intent: requirementEditEvents.intent, blockIds: requirementEditEvents.blockIds }).from(requirementEditEvents)
    .where(and(eq(requirementEditEvents.requirementId, requirementId), gt(requirementEditEvents.sequence, after), lte(requirementEditEvents.sequence, until)))
    .orderBy(asc(requirementEditEvents.sequence))
}

export async function currentNodeContributions(db: Db, record: Collaboration) {
  const base = await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, record.requirementId), orderBy: desc(requirementRevisions.version) })
  if (isAttributionSnapshot(record.attribution) && record.attribution.baseRevisionId === (base?.id ?? null)) return record.attribution
  return attributionFromReceipts(normalizedRevision(base), record, await receipts(db, record.requirementId, base?.attributionSequence ?? 0, record.attributionSequence))
}

/** 不重写历史行；旧版本在读取时按已有编辑序号汇总。 */
export async function revisionNodeContributions<T extends Revision>(db: Db, revision: T) {
  if (isAttributionSnapshot(revision.attribution)) return { ...revision, attribution: revision.attribution }
  if (revision.attribution?.version !== 1 || revision.attributionSequence === null) return { ...revision, attribution: null }
  const base = await db.query.requirementRevisions.findFirst({ where: and(eq(requirementRevisions.requirementId, revision.requirementId), eq(requirementRevisions.version, revision.version - 1)) })
  const attribution = attributionFromReceipts(normalizedRevision(base), normalizedRevision(revision)!, await receipts(db, revision.requirementId, base?.attributionSequence ?? 0, revision.attributionSequence))
  return { ...revision, attribution }
}
