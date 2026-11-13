import { createHash } from 'node:crypto'
import { createError, getRequestIP, type H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { useDatabase } from '../db/client'
import { authRateLimits } from '../db/schema'

export async function limitAccountRequest(event: H3Event, scope: string, max: number, userId?: string) {
  const identity = userId ?? getRequestIP(event) ?? 'unknown'
  const key = `accounts:${scope}:${createHash('sha256').update(identity).digest('hex')}`
  const now = Date.now()
  const reset = sql`${now} - ${authRateLimits.lastRequest} >= 60000`
  // 仅 key 用于冲突合并；复用 key 作为主键会在并发插入时触发另一条唯一约束。
  const [row] = await useDatabase().insert(authRateLimits).values({ id: nanoid(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        count: sql`case when ${reset} then 1 else ${authRateLimits.count} + 1 end`,
        lastRequest: sql`case when ${reset} then ${now} else ${authRateLimits.lastRequest} end`,
      },
    }).returning({ count: authRateLimits.count })
  if (!row || row.count > max) {
    throw createError({ statusCode: 429, message: '操作过于频繁，请稍后再试' })
  }
}
