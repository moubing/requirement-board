import type { AccountAudit, ProjectRole } from '#shared/auth/access'
import { PROJECT_ROLE_LABELS } from '#shared/auth/access'
import { AUDIT_ACTION_LABELS, isAuditAction } from '#shared/audit/events'
import { resolveAccountAuditAction } from '#shared/auth/audit'

export function accountAuditLabel(event: AccountAudit) {
  const action = resolveAccountAuditAction(event)
  if (action === 'request.submit' && event.detail.source === 'registration') return '注册并提交加入申请'
  return isAuditAction(action) ? AUDIT_ACTION_LABELS[action] : '账号操作'
}

export function accountAuditSummary(event: AccountAudit) {
  const detail = event.detail
  if (resolveAccountAuditAction(event) === 'request.update' && typeof detail.message === 'string') {
    const after = detail.message || '（已清空）'
    if (typeof detail.previousMessage === 'string') {
      return `申请说明：${detail.previousMessage || '（未填写）'} → ${after}`
    }
    return `申请说明：${after}`
  }
  if (detail.reason || detail.note || detail.message) return String(detail.reason || detail.note || detail.message)
  const show = (value: unknown): string => {
    if (Array.isArray(value)) return value.map((role) => PROJECT_ROLE_LABELS[role as ProjectRole]).join('、') || '普通成员'
    if (value && typeof value === 'object') {
      const state = value as { name?: string; systemRole?: string; projectRoles?: ProjectRole[] }
      return [state.name, state.systemRole === 'admin' ? '超级管理员' : '普通用户', show(state.projectRoles ?? [])].join(' · ')
    }
    return ''
  }
  if (detail.before !== undefined && detail.after !== undefined) return `${show(detail.before)} → ${show(detail.after)}`
  if (event.action === 'user.create') return show(detail)
  if (Array.isArray(detail.roles)) return `项目角色：${show(detail.roles)}`
  return ''
}
