import { z } from 'zod'
import { PROJECT_ROLES } from './access'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy'

export const rolesSchema = z.array(z.enum(PROJECT_ROLES)).max(PROJECT_ROLES.length)
  .transform((roles) => [...new Set(roles)].sort())

const nameSchema = z.string().trim().min(1, '请填写姓名').max(80, '姓名不能超过 80 个字符')
const emailSchema = z.string().trim().pipe(z.email('请填写有效的邮箱').max(160, '邮箱不能超过 160 个字符'))
  .transform((email) => email.toLowerCase())
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH, `密码至少 ${MIN_PASSWORD_LENGTH} 个字符`)
  .max(MAX_PASSWORD_LENGTH, `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符`)

export const invitationInputSchema = z.object({ name: nameSchema, email: emailSchema, roles: rolesSchema }).strict()

export const managedUserCreateSchema = z.object({
  name: nameSchema,
  username: z.string().trim().min(3, '用户名至少 3 个字符').max(30, '用户名不能超过 30 个字符')
    .regex(/^[a-zA-Z0-9_.]+$/, '用户名只能包含字母、数字、下划线或点').transform((username) => username.toLowerCase()),
  email: emailSchema,
  password: passwordSchema,
  systemRole: z.enum(['user', 'admin']).default('user'),
  roles: rolesSchema,
}).strict()

export const registrationSchema = managedUserCreateSchema.pick({ name: true, username: true, email: true, password: true })
  .extend({ confirmation: z.string().min(1, '请再次输入密码') })
  .refine(data => data.password === data.confirmation, { path: ['confirmation'], message: '两次输入的密码不一致' })

export const userUpdateSchema = z.object({
  name: nameSchema.optional(),
  systemRole: z.enum(['admin', 'user']).optional(),
  projectRoles: rolesSchema.optional(),
}).strict().refine(data => Object.keys(data).length > 0, '请填写要更新的内容')

export const accountStatusSchema = z.object({
  disabled: z.boolean(),
  reason: z.string().trim().max(500, '停用原因不能超过 500 个字符').default(''),
}).strict().refine(data => !data.disabled || data.reason.length > 0, { path: ['reason'], message: '请填写停用原因' })

export const accessRequestSchema = z.object({ message: z.string().trim().max(1000, '加入说明不能超过 1000 个字符').default('') }).strict()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请填写当前密码').max(MAX_PASSWORD_LENGTH, `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符`),
  newPassword: passwordSchema,
  confirmation: z.string().min(1, '请再次输入新密码'),
}).strict().refine((data) => data.newPassword === data.confirmation, {
  path: ['confirmation'], message: '两次输入的新密码不一致',
})

// 前端 BingForm 与审批接口共用规则，错误路径对应 BingFormItem 的 prop。
export const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  roles: rolesSchema.default([]),
  note: z.string().trim().max(1000, '审批说明不能超过 1000 个字符').default(''),
}).strict()
  .refine((data) => data.decision !== 'approve' || data.roles.length > 0, {
    path: ['roles'], message: '请至少选择一个项目角色',
  })
  .refine((data) => data.decision !== 'reject' || data.note.length > 0, {
    path: ['note'], message: '请填写拒绝原因',
  })
