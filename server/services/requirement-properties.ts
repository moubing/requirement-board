import { and, desc, eq, inArray, lt, or } from 'drizzle-orm'
import { createError } from 'h3'
import { nanoid } from 'nanoid'
import type { Database, Transaction } from '../db/client'
import { auditEvents, projectMembers, requirements, requirementStatuses, users } from '../db/schema'
import { writeAudit } from './audit'
import { PROPERTY_LABELS, PRIORITY_LABELS, type PropertyChange, type PropertySource, type RequirementProperties, type RequirementPropertyPatch } from '../../shared/requirements/properties'
import { belongsToDocumentType, DOCUMENT_TYPE_LABELS, DOCUMENT_STATES, initialDocumentState, type DocumentType } from '../../shared/documents/workflow'
import { readDocumentAssigneeIds, replaceDocumentAssignees } from './document-assignees'
import { recordRequirementMilestone } from './requirement-milestones'

export async function propertiesOf(db: Database | Transaction, row: { id: string; statusId: string; priority: string }): Promise<RequirementProperties> {
  return { statusId: row.statusId, assigneeIds: await readDocumentAssigneeIds(db, row.id), priority: row.priority as RequirementProperties['priority'] }
}

export function normalizeAssignments(patch: RequirementPropertyPatch): RequirementPropertyPatch {
  if (patch.assigneeIds === undefined) return { ...patch }
  const ids = [...patch.assigneeIds].sort()
  if (new Set(ids).size !== ids.length) {
    throw createError({ statusCode: 400, message: '负责人不能重复' })
  }
  return { ...patch, assigneeIds: ids }
}

export async function validateProperties(tx: Database | Transaction, projectId: string, input: RequirementPropertyPatch,
  context?: { documentType: DocumentType; statusId?: string }) {
  const patch = normalizeAssignments(input)
  if (patch.statusId !== undefined) {
    const target = await tx.query.requirementStatuses.findFirst({ where: and(eq(requirementStatuses.id, patch.statusId), eq(requirementStatuses.projectId, projectId)) })
    if (!target) throw createError({ statusCode: 400, message: '状态不属于当前项目' })
    if (context) {
      // 同类型内任意切换；新建只能使用该类型的初始状态，保证统计从创建时起完整。
      const type = DOCUMENT_TYPE_LABELS[context.documentType]
      if (!context.statusId && target.code !== initialDocumentState(context.documentType)) {
        throw createError({ statusCode: 409, message: `新建${type}必须从「${DOCUMENT_STATES[initialDocumentState(context.documentType)].name}」开始`, data: { code: 'INVALID_TRANSITION' } })
      }
      if (!belongsToDocumentType(context.documentType, target.code)) {
        throw createError({ statusCode: 409, message: `「${target.name}」不是${type}可用的状态`, data: { code: 'INVALID_TRANSITION' } })
      }
    }
  }
  if (patch.assigneeIds?.length) {
    const members = await tx.select({ id: users.id }).from(projectMembers).innerJoin(users, eq(projectMembers.userId, users.id))
      .where(and(eq(projectMembers.projectId, projectId), inArray(users.id, patch.assigneeIds), eq(users.banned, false)))
    if (members.length !== patch.assigneeIds.length) throw createError({ statusCode: 400, message: '负责人必须是项目中启用的成员' })
  }
}

export async function describePropertyChanges(tx: Database | Transaction, before: RequirementPropertyPatch, patch: RequirementPropertyPatch): Promise<PropertyChange[]> {
  const label = async (field: keyof RequirementProperties, value: string | string[] | null | undefined) => {
    if (Array.isArray(value)) {
      const people = value.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, value)) : []
      return { value, label: value.map(id => people.find(person => person.id === id)?.name ?? id).join('、') || '未指派' }
    }
    if (value == null) return { value: null, label: '未设置' }
    const name = field === 'statusId' ? (await tx.query.requirementStatuses.findFirst({ where: eq(requirementStatuses.id, value) }))?.name
      : PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS]
    return { value, label: name ?? value }
  }
  const result: PropertyChange[] = []
  for (const field of Object.keys(PROPERTY_LABELS) as (keyof RequirementProperties)[]) {
    if (patch[field] === undefined || JSON.stringify(before[field]) === JSON.stringify(patch[field])) continue
    result.push({ field, label: PROPERTY_LABELS[field], before: await label(field, before[field]), after: await label(field, patch[field]) })
  }
  return result
}

/** 调用方持有需求行锁；属性和逐字段日志一起提交。 */
export async function updateRequirementProperties(tx: Transaction, row: typeof requirements.$inferSelect, patch: RequirementPropertyPatch,
  actorId: string, source: PropertySource, operationId = `operation_${nanoid(24)}`, agentUserId?: string) {
  await validateProperties(tx, row.projectId, patch, row)
  const normalized = normalizeAssignments(patch)
  const changes = await describePropertyChanges(tx, await propertiesOf(tx, row), normalized)
  if (!changes.length) return changes
  const { assigneeIds, ...metadata } = normalized
  if (changes.some(change => change.field === 'assigneeIds')) await replaceDocumentAssignees(tx, row.id, assigneeIds!)
  await tx.update(requirements).set({ ...metadata, updatedAt: new Date() }).where(eq(requirements.id, row.id))
  for (const change of changes) await writeAudit(tx, { action: 'requirement.property.change', projectId: row.projectId,
    actorId, subjectUserId: null, targetId: row.id, detail: { ...change, operationId, source, ...(agentUserId ? { agentUserId } : {}) } })
  if (changes.some(change => change.field === 'statusId')) await recordRequirementMilestone(tx, row, normalized.statusId!, source, operationId)
  return changes
}

/** 标题独立保存；历史版本的标题快照不随属性变更改写。调用方持有需求行锁。 */
export async function updateRequirementTitle(tx: Transaction, row: typeof requirements.$inferSelect, title: string,
  actorId: string, source: PropertySource, operationId = `operation_${nanoid(24)}`) {
  if (title === row.title) return false
  await tx.update(requirements).set({ title, updatedAt: new Date() }).where(eq(requirements.id, row.id))
  await writeAudit(tx, { action: 'requirement.property.change', projectId: row.projectId, actorId,
    subjectUserId: null, targetId: row.id, detail: { field: 'title', label: '标题',
      before: { value: row.title, label: row.title }, after: { value: title, label: title }, operationId, source } })
  return true
}

export async function propertyHistory(db: Database, projectId: string, requirementId: string, cursor?: string) {
  const row = await db.query.requirements.findFirst({ where: and(eq(requirements.id, requirementId), eq(requirements.projectId, projectId)) })
  if (!row) throw createError({ statusCode: 404, message: '需求不存在' })
  const filters = [eq(auditEvents.projectId, projectId), eq(auditEvents.targetId, requirementId), eq(auditEvents.action, 'requirement.property.change')]
  if (cursor) {
    const anchor = await db.query.auditEvents.findFirst({ where: and(...filters, eq(auditEvents.id, cursor)) })
    if (!anchor) throw createError({ statusCode: 400, message: '日志分页位置无效' })
    filters.push(or(lt(auditEvents.createdAt, anchor.createdAt), and(eq(auditEvents.createdAt, anchor.createdAt), lt(auditEvents.id, anchor.id)))!)
  }
  const rows = await db.select({ id: auditEvents.id, detail: auditEvents.detail, createdAt: auditEvents.createdAt,
    actor: { id: users.id, name: users.name } }).from(auditEvents).innerJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(...filters)).orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)).limit(51)
  return { items: rows.slice(0, 50).map(row => ({ ...row.detail, id: row.id, actor: row.actor, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > 50 ? rows[49]!.id : null }
}
