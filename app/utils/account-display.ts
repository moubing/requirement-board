import { FetchError } from 'ofetch'
import type { ManagedUser, ProjectRole } from '#shared/auth/access'
import { PROJECT_ROLE_LABELS } from '#shared/auth/access'

export function accountError(error: unknown) {
  if (error instanceof FetchError) {
    if (error.statusCode === 401) return '登录已失效，请重新登录'
    if (error.statusCode === 429) return '操作过于频繁，请稍后再试'
    if (error.statusCode && error.statusCode < 500 && error.data?.message) return String(error.data.message)
  }
  return '操作失败，请稍后重试'
}
export function roleText(roles: ProjectRole[]) {
  return roles.map((role) => PROJECT_ROLE_LABELS[role]).join('、') || '普通成员'
}
export function userStatus(user: ManagedUser) {
  if (user.banned) return '已停用'
  if (user.isMember || user.role === 'admin') return '已启用'
  return user.requestStatus === 'pending' ? '待审批' : user.requestStatus === 'rejected' ? '申请被拒绝' : '未加入'
}
export function accountDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}
