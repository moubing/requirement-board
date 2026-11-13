import { eq, inArray } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client'
import { requirementAssignees, users } from '../db/schema'

export async function readDocumentAssigneeIds(db: Database | Transaction, requirementId: string) {
  const rows = await db.select({ userId: requirementAssignees.userId }).from(requirementAssignees)
    .where(eq(requirementAssignees.requirementId, requirementId))
  return rows.map(row => row.userId).sort()
}

/** 调用方已校验成员并持有文档行锁，分配关系与属性日志在同一事务提交。 */
export async function replaceDocumentAssignees(tx: Transaction, requirementId: string, userIds: string[]) {
  await tx.delete(requirementAssignees).where(eq(requirementAssignees.requirementId, requirementId))
  if (userIds.length) await tx.insert(requirementAssignees).values(userIds.map(userId => ({ requirementId, userId })))
}

export async function withDocumentAssignees<T extends { id: string }>(db: Database | Transaction, rows: T[]) {
  const assignments = rows.length ? await db.select({ requirementId: requirementAssignees.requirementId,
    user: { id: users.id, name: users.name, avatarColor: users.avatarColor } })
    .from(requirementAssignees).innerJoin(users, eq(users.id, requirementAssignees.userId))
    .where(inArray(requirementAssignees.requirementId, rows.map(row => row.id))) : []
  const people = new Map<string, (typeof assignments)[number]['user'][]>()
  for (const { requirementId, user } of assignments) {
    const list = people.get(requirementId) ?? []
    list.push(user)
    people.set(requirementId, list)
  }
  return rows.map(row => {
    const assignees = (people.get(row.id) ?? []).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return { ...row, assigneeIds: assignees.map(user => user.id), assignees }
  })
}
