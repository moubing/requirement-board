import { z } from 'zod'
import { createError } from 'h3'

// 旧 token 只作为未命中缓存处理，不能代替 schema 3 的快照。
export const contentTokenSchema = z.string().regex(/^[23]:[a-f0-9]{64}$/)
export const documentRefSchema = z.string().regex(/^(draft|latest|v[1-9][0-9]{0,9}|rev_[a-zA-Z0-9_-]{1,100})$/)
  .refine(value => !value.startsWith('v') || Number(value.slice(1)) <= 2147483647, '版本号超出范围')
export const conditionalReadSchema = z.object({ ifContentToken: contentTokenSchema.optional() }).strict()
export const diffQuerySchema = z.object({
  from: documentRefSchema.default('latest'), to: documentRefSchema.default('draft'),
  stat: z.enum(['true', 'false']).default('false'),
  offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(30),
  comparisonToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()
export const historyQuerySchema = z.object({
  text: z.string().min(1).max(4000).optional(), block: z.string().min(1).max(200).optional(),
  start: z.coerce.number().int().min(0).optional(), at: documentRefSchema.default('draft'),
}).strict().refine(value => value.text || value.block, '需要 text 或 block')

export function parseAgentQuery<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw createError({ statusCode: 400, message: '查询参数无效', data: { issues: parsed.error.issues } })
  return parsed.data
}
