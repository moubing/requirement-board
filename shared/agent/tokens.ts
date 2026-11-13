import { z } from 'zod'

export const agentTokenInputSchema = z.object({
  name: z.string().trim().min(1, '请输入凭证名称').max(80),
  expiresInDays: z.number({ error: '请输入有效期天数' }).int('有效期必须为整数').min(1, '有效期至少为 1 天').max(90, '有效期不能超过 90 天').default(30),
}).strict()

export interface AgentTokenDto {
  id: string
  name: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
}

const positiveInteger = (maximum: number) => z.union([z.string().regex(/^\d+$/), z.number()])
  .transform(Number).pipe(z.number().int().min(1).max(maximum))
export const agentTokenQuerySchema = z.object({
  page: positiveInteger(Number.MAX_SAFE_INTEGER).default(1),
  limit: positiveInteger(100).default(10),
  status: z.enum(['all', 'active', 'expired', 'revoked']).default('all'),
}).strict().refine(value => Number.isSafeInteger((value.page - 1) * value.limit), '分页范围过大')
export type AgentTokenQuery = z.output<typeof agentTokenQuerySchema>
export interface AgentTokenPage {
  items: AgentTokenDto[]
  total: number
  page: number
  limit: number
  activeCount: number
  asOf: string
}

export function agentTokenStatus(token: Pick<AgentTokenDto, 'expiresAt' | 'revokedAt'>, asOf: string) {
  return token.revokedAt ? 'revoked' : Date.parse(token.expiresAt) <= Date.parse(asOf) ? 'expired' : 'active'
}
