import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import { createError } from 'h3'
import type { RelatedDocumentDto } from '../../shared/requirements/relations'
import type { Database, Transaction } from '../db/client'
import { requirementRelations, requirements, requirementStatuses } from '../db/schema'
import { assertRequirementUnlocked } from './agent-locks'
import { broadcastRequirementProperties } from './collaboration'

export async function readRelatedDocuments(db: Database | Transaction, projectId: string, id: string): Promise<RelatedDocumentDto[]> {
  return db.select({ id: requirements.id, key: requirements.key, title: requirements.title, documentType: requirements.documentType,
    status: { id: requirementStatuses.id, code: requirementStatuses.code, name: requirementStatuses.name, color: requirementStatuses.color } })
    .from(requirementRelations)
    .innerJoin(requirements, or(
      and(eq(requirementRelations.firstId, id), eq(requirements.id, requirementRelations.secondId)),
      and(eq(requirementRelations.secondId, id), eq(requirements.id, requirementRelations.firstId)),
    )!)
    .innerJoin(requirementStatuses, eq(requirements.statusId, requirementStatuses.id))
    .where(and(eq(requirementRelations.projectId, projectId), eq(requirements.projectId, projectId)))
    .orderBy(desc(requirementRelations.createdAt), asc(requirements.key))
}

export async function listRelatedDocuments(db: Database, projectId: string, id: string) {
  const row = await db.query.requirements.findFirst({ columns: { id: true }, where: and(eq(requirements.id, id), eq(requirements.projectId, projectId)) })
  if (!row) throw createError({ statusCode: 404, message: '文档不存在' })
  return readRelatedDocuments(db, projectId, id)
}

export async function changeRelatedDocuments(db: Database, projectId: string, id: string, documentIds: string[], action: 'add' | 'remove') {
  if (documentIds.includes(id)) throw createError({ statusCode: 400, message: '不能关联文档自身' })
  const ids = [...new Set([id, ...documentIds])]
  const result = await db.transaction(async tx => {
    // 所有方向、所有批次按同一顺序锁文档，避免 A→B 与 B→A 并发死锁。
    const rows = await tx.select({ id: requirements.id }).from(requirements)
      .where(and(eq(requirements.projectId, projectId), inArray(requirements.id, ids))).orderBy(asc(requirements.id)).for('update')
    if (rows.length !== ids.length) throw createError({ statusCode: 404, message: '部分文档不存在或不可访问，请刷新后重试' })
    for (const row of rows) await assertRequirementUnlocked(tx, row.id)

    const pairs = [...new Set(documentIds)].map(target => {
      // 与数据库 C 排序保持一致，包括非 ASCII 的历史 ID。
      const [firstId, secondId] = [id, target].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) as [string, string]
      return { projectId, firstId, secondId }
    })
    const changed = action === 'add'
      ? await tx.insert(requirementRelations).values(pairs).onConflictDoNothing().returning()
      : await tx.delete(requirementRelations).where(and(eq(requirementRelations.projectId, projectId),
        or(...pairs.map(pair => and(eq(requirementRelations.firstId, pair.firstId), eq(requirementRelations.secondId, pair.secondId)))))).returning()
    const changedIds = [...new Set(changed.flatMap(pair => [pair.firstId, pair.secondId]))]
    if (changedIds.length) await tx.update(requirements).set({ updatedAt: new Date() })
      .where(and(eq(requirements.projectId, projectId), inArray(requirements.id, changedIds)))
    return { documents: await readRelatedDocuments(tx, projectId, id), changedIds }
  })
  for (const changedId of result.changedIds) broadcastRequirementProperties(changedId)
  return result.documents
}
