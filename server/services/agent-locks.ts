import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { AgentLockDto } from '../../shared/agent/lock'
import type { Database, Transaction } from '../db/client'
import { agentTokens, projectMembers, requirementAgentLocks, requirements, users } from '../db/schema'

/** 调用写入保护时须已取得需求行锁，或持有共同文档的串行写入队列。 */
export async function activeAgentLock(db: Database | Transaction, requirementId: string) {
  const [row] = await db.select({ lock: requirementAgentLocks, token: agentTokens,
    user: { id: users.id, name: users.name, role: users.role, banned: users.banned }, memberId: projectMembers.userId })
    .from(requirementAgentLocks)
    .innerJoin(agentTokens, eq(agentTokens.id, requirementAgentLocks.tokenId))
    .innerJoin(users, eq(users.id, agentTokens.userId))
    .innerJoin(requirements, eq(requirements.id, requirementAgentLocks.requirementId))
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, requirements.projectId), eq(projectMembers.userId, users.id)))
    .where(eq(requirementAgentLocks.requirementId, requirementId))
  if (!row || row.lock.expiresAt.getTime() <= Date.now() || row.token.expiresAt.getTime() <= Date.now()
    || row.token.revokedAt || row.user.banned || (row.user.role !== 'admin' && !row.memberId)) return null
  const view: AgentLockDto = { snapshotId: row.lock.snapshotId, userId: row.user.id, userName: row.user.name,
    acquiredAt: row.lock.acquiredAt.toISOString(), expiresAt: row.lock.expiresAt.toISOString(),
    suggestionId: row.lock.suggestionId }
  return { ...row, view }
}

export function requirementLocked(lock: AgentLockDto) {
  return createError({ statusCode: 423, message: `需求已由 ${lock.userName} 的 AI 锁定，当前只能查看`,
    data: { code: 'REQUIREMENT_LOCKED', lock } })
}

export function agentLockLost() {
  return createError({ statusCode: 409, message: 'AI 编辑锁已释放或过期，请重新读取当前草稿', data: { code: 'AGENT_LOCK_LOST' } })
}

export async function assertRequirementUnlocked(db: Database | Transaction, requirementId: string) {
  const active = await activeAgentLock(db, requirementId)
  if (active) throw requirementLocked(active.view)
}
