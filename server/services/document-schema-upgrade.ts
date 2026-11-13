import { eq, lt } from 'drizzle-orm'
import * as Y from 'yjs'
import type { Database } from '../db/client'
import { requirementAgentLocks, requirementCollaborationDocuments, requirements } from '../db/schema'
import { upgradeCollaborativeCellIds } from '../../shared/collaboration/cell-identity'
import { readCollaborationDocument } from '../../shared/collaboration/document'
import { draftDocumentSchema } from '../../shared/drafts/validation'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'

/** 停服迁移步骤；每篇独立事务，可中断后幂等继续。历史 revision 不参与写入。 */
export async function upgradeDocumentSchemas(db: Database) {
  const rows = await db.select({ id: requirementCollaborationDocuments.requirementId }).from(requirementCollaborationDocuments)
    .where(lt(requirementCollaborationDocuments.schemaVersion, DOCUMENT_SCHEMA_VERSION))
  let upgraded = 0
  for (const { id } of rows) {
    await db.transaction(async tx => {
      await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, id)).for('update')
      const [record] = await tx.select().from(requirementCollaborationDocuments).where(eq(requirementCollaborationDocuments.requirementId, id)).for('update')
      if (!record || record.schemaVersion >= DOCUMENT_SCHEMA_VERSION) return
      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, record.state)
        upgradeCollaborativeCellIds(doc)
        const contentJson = draftDocumentSchema.parse(readCollaborationDocument(doc).contentJson)
        await tx.update(requirementCollaborationDocuments).set({ state: Y.encodeStateAsUpdate(doc), contentJson,
          schemaVersion: DOCUMENT_SCHEMA_VERSION, editEpoch: record.editEpoch + 1 })
          .where(eq(requirementCollaborationDocuments.requirementId, id))
        await tx.delete(requirementAgentLocks).where(eq(requirementAgentLocks.requirementId, id))
        upgraded++
      } finally { doc.destroy() }
    })
  }
  return upgraded
}
