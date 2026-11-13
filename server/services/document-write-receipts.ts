import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { createError, getHeader, type H3Event } from 'h3'
import type { Transaction } from '../db/client'
import { documentWriteReceipts } from '../db/schema'

export function documentWriteKey(event: H3Event) {
  const key = getHeader(event, 'Idempotency-Key')
  if (key !== undefined && !/^[a-zA-Z0-9_-]{12,100}$/.test(key)) throw createError({ statusCode: 400, message: '提交标识格式无效' })
  return key
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
async function receiptQuery<T>(query: () => PromiseLike<T>): Promise<T> {
  try { return await query() }
  catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } }
    const code = failure.cause?.code ?? failure.code
    // 不把 Drizzle 的 SQL 和参数带入 API 错误；503 让客户端保留原提交标识以便重试。
    console.error('文档写入回执查询失败', { code: code ?? 'unknown' })
    throw createError({ statusCode: 503,
      message: code === '42P01' ? '服务升级尚未完成，请联系管理员处理后重试。' : '暂时无法确认提交结果，请稍后重试。',
      data: { code: code === '42P01' ? 'DATABASE_MIGRATION_REQUIRED' : 'DOCUMENT_WRITE_UNAVAILABLE' },
    })
  }
}
export async function documentWriteReceipt(tx: Transaction, actor: { projectId: string; userId: string }, requestId: string | undefined,
  operation: 'requirement.create' | 'template.save', input: unknown) {
  if (!requestId) return { resourceId: undefined, complete: async (_id: string) => {} }
  const identity = { ...actor, requestId }
  await receiptQuery(() => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(identity)}, 0))`))
  const inputHash = createHash('sha256').update(canonical(input)).digest('hex')
  const existing = await receiptQuery(() => tx.query.documentWriteReceipts.findFirst({ where: and(eq(documentWriteReceipts.projectId, actor.projectId),
    eq(documentWriteReceipts.userId, actor.userId), eq(documentWriteReceipts.requestId, requestId)) }))
  if (existing && (existing.operation !== operation || existing.inputHash !== inputHash)) {
    throw createError({ statusCode: 409, message: '同一提交标识不能用于不同内容，请先核验原提交结果' })
  }
  return { resourceId: existing?.resourceId,
    complete: async (resourceId: string) => { await receiptQuery(() => tx.insert(documentWriteReceipts).values({ ...identity, operation, inputHash, resourceId })) } }
}
