import { z } from 'zod'
import { createError } from 'h3'
import { PROJECT_ROLES } from '../../shared/auth/access'
export { rolesSchema, reviewSchema, invitationInputSchema, managedUserCreateSchema, userUpdateSchema, accountStatusSchema } from '../../shared/auth/account-input'
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export const userQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(160).default(''),
  role: z.enum([...PROJECT_ROLES, '']).default(''),
  status: z.enum(['', 'active', 'disabled', 'pending', 'rejected', 'unjoined']).default(''),
})
export const tokenInputSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()

export function parseAccountInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? '请求参数不正确' })
  }
  return parsed.data
}
