import { createHash, randomBytes } from 'node:crypto'
import { and, count, desc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { createError, type H3Event } from 'h3'
import { nanoid } from 'nanoid'
import { agentTokens, users } from '../db/schema'
import { useDatabase, type Database } from '../db/client'
import { requireProjectContext } from '../utils/request-context'
import { writeAudit } from './audit'
import type { AgentTokenPage, AgentTokenQuery } from '../../shared/agent/tokens'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const publicToken = ({ id, name, createdAt, expiresAt, revokedAt }: Pick<typeof agentTokens.$inferSelect, 'id' | 'name' | 'createdAt' | 'expiresAt' | 'revokedAt'>) => ({
  id, name, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), revokedAt: revokedAt?.toISOString() ?? null,
})

/** Agent routes accept only PATs; review routes continue to require a browser session. */
export async function requireAgentContext(event: H3Event) {
  const authorization = event.headers.get('authorization')
  if (!authorization || !/^Bearer rb_agent_[A-Za-z0-9_-]{43}$/.test(authorization)) {
    throw createError({ statusCode: 401, message: '需要有效的 AI 凭证' })
  }
  const db = useDatabase()
  const token = await db.query.agentTokens.findFirst({ where: eq(agentTokens.tokenHash, hashToken(authorization.slice(7))) })
  if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) throw createError({ statusCode: 401, message: 'AI 凭证已失效' })
  const currentUser = await db.query.users.findFirst({ where: eq(users.id, token.userId) })
  if (!currentUser || currentUser.banned) throw createError({ statusCode: 403, message: '账号已停用' })
  return requireProjectContext({ db, currentUser, currentUserId: currentUser.id, agentTokenId: token.id })
}

export async function listAgentTokens(db: Database, userId: string, query: AgentTokenQuery): Promise<AgentTokenPage> {
  return db.transaction(async tx => {
    const [clock] = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`)
    const at = new Date(clock!.at)
    const owner = eq(agentTokens.userId, userId)
    const active = and(isNull(agentTokens.revokedAt), gt(agentTokens.expiresAt, at))
    const filter = query.status === 'active' ? active : query.status === 'expired'
      ? and(isNull(agentTokens.revokedAt), lte(agentTokens.expiresAt, at))
      : query.status === 'revoked' ? isNotNull(agentTokens.revokedAt) : undefined
    const [matched] = await tx.select({ total: count() }).from(agentTokens).where(and(owner, filter))
    const [available] = await tx.select({ total: count() }).from(agentTokens).where(and(owner, active))
    const items = await tx.select({ id: agentTokens.id, name: agentTokens.name, createdAt: agentTokens.createdAt,
      expiresAt: agentTokens.expiresAt, revokedAt: agentTokens.revokedAt }).from(agentTokens)
      .where(and(owner, filter)).orderBy(desc(agentTokens.createdAt), desc(sql`${agentTokens.id} collate "C"`))
      .limit(query.limit).offset((query.page - 1) * query.limit)
    return { items: items.map(publicToken), total: matched!.total, page: query.page, limit: query.limit,
      activeCount: available!.total, asOf: at.toISOString() }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function createAgentToken(db: Database, userId: string, projectId: string, input: { name: string; expiresInDays: number }) {
  const secret = `rb_agent_${randomBytes(32).toString('base64url')}`
  const record = await db.transaction(async tx => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
    const [active] = await tx.select({ count: sql<number>`count(*)::int` }).from(agentTokens)
      .where(and(eq(agentTokens.userId, userId), isNull(agentTokens.revokedAt), sql`${agentTokens.expiresAt} > now()`))
    if (active!.count >= 10) throw createError({ statusCode: 400, message: '最多保留 10 个有效凭证，请先撤销不用的凭证' })
    const [created] = await tx.insert(agentTokens).values({ id: `pat_${nanoid(24)}`, userId, name: input.name,
      tokenHash: hashToken(secret), expiresAt: new Date(Date.now() + input.expiresInDays * 86400_000) }).returning()
    await writeAudit(tx, { action: 'agent.token.create', projectId, actorId: userId, subjectUserId: userId, targetId: created!.id,
      detail: { name: created!.name, expiresAt: created!.expiresAt.toISOString() } })
    return created!
  })
  return { ...publicToken(record), token: secret }
}

export async function revokeAgentToken(db: Database, userId: string, projectId: string, id: string) {
  await db.transaction(async tx => {
    const [token] = await tx.select().from(agentTokens).where(and(eq(agentTokens.id, id), eq(agentTokens.userId, userId))).for('update')
    if (!token) throw createError({ statusCode: 404, message: '凭证不存在' })
    if (token.revokedAt) return
    await tx.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, id))
    await writeAudit(tx, { action: 'agent.token.revoke', projectId, actorId: userId, subjectUserId: userId, targetId: id, detail: { name: token.name } })
  })
  return { revoked: true }
}
