import { describe, expect, it } from 'vitest'
import { changePasswordSchema, managedUserCreateSchema } from '../../shared/auth/account-input'

describe('account creation and password form rules', () => {
  it('normalizes identity fields, defaults to a user and preserves the exact password', () => {
    expect(managedUserCreateSchema.parse({ name: ' 张三 ', username: ' ZHANG.SAN ', email: ' User@Example.com ', password: '  pass word  ', roles: ['qa', 'developer', 'qa'] }))
      .toEqual({ name: '张三', username: 'zhang.san', email: 'user@example.com', password: '  pass word  ', systemRole: 'user', roles: ['developer', 'qa'] })
  })

  it('assigns errors to the required creation fields for BingFormItem', () => {
    const result = managedUserCreateSchema.safeParse({ name: '', username: '', email: '', password: '', roles: [] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(['name', 'username', 'email', 'password']))
  })

  it('requires matching confirmation and preserves passwords including whitespace', () => {
    const form = { currentPassword: ' old password ', newPassword: ' new password ', confirmation: 'different' }
    const result = changePasswordSchema.safeParse(form)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['confirmation'], message: '两次输入的新密码不一致' }))
    expect(changePasswordSchema.parse({ ...form, confirmation: form.newPassword })).toEqual({ ...form, confirmation: form.newPassword })
  })
})
