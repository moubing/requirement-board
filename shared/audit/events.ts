import type { ProjectRole, RequestStatus } from '../auth/access'
import type { PropertyChange, PropertyLogSource, PropertySource } from '../requirements/properties'

type RequestSubmissionDetail = {
  previousStatus: RequestStatus | null
  previousReviewNote: string
  previousMessage: string
  message: string
}

type UserAuditState = {
  name: string
  systemRole: string
  projectRoles: ProjectRole[]
}

// 新增业务事件时，在这里声明其详情，并补齐下面的中文名称。
export type AuditEventDetails = {
  'agent.token.create': { name: string; expiresAt: string }
  'agent.token.revoke': { name: string }
  'agent.suggestion.create': { requirementId: string | null }
  'agent.suggestion.apply': { requirementId: string; editId: string | null; source?: PropertySource }
  'agent.suggestion.reject': { requirementId: string | null }
  'requirement.property.change': PropertyChange & { operationId: string; source: PropertyLogSource; agentUserId?: string }
  'request.submit': { source: 'registration' } | RequestSubmissionDetail
  'request.update': RequestSubmissionDetail
  'request.resubmit': RequestSubmissionDetail
  'request.approve': { note: string; roles: ProjectRole[] }
  'request.reject': { note: string; roles: ProjectRole[] }
  'invitation.create': { email: string; roles: ProjectRole[] }
  'invitation.link.read': { email: string }
  'invitation.revoke': { email: string }
  'invitation.accept': { roles: ProjectRole[]; existingMember: boolean }
  'user.create': UserAuditState & { username: string; email: string }
  'user.update': { before: UserAuditState; after: UserAuditState }
  'user.disable': { reason: string }
  'user.enable': { reason: string }
  'user.revoke-sessions': Record<string, never>
  'member.roles': { before: ProjectRole[]; after: ProjectRole[] }
}

export type AuditAction = keyof AuditEventDetails

type AuditTarget = {
  projectId: string
  actorId: string
  targetId: string
  subjectUserId: string | null
}

// action 是判别字段：详情必须与所选动作对应，不能任意组合两个联合类型。
export type AuditEvent = {
  [Action in AuditAction]: AuditTarget & { action: Action; detail: AuditEventDetails[Action] }
}[AuditAction]

export const AUDIT_ACTION_LABELS = {
  'agent.token.create': '创建 AI 凭证',
  'agent.token.revoke': '撤销 AI 凭证',
  'agent.suggestion.create': '提交 AI 文档操作',
  'agent.suggestion.apply': '执行 AI 文档操作',
  'agent.suggestion.reject': '取消 AI 文档操作',
  'requirement.property.change': '修改文档属性',
  'request.submit': '提交加入申请',
  'request.update': '更新申请说明',
  'request.resubmit': '重新提交加入申请',
  'request.approve': '批准加入申请',
  'request.reject': '拒绝加入申请',
  'invitation.create': '创建邀请',
  'invitation.link.read': '获取邀请链接',
  'invitation.revoke': '撤销邀请',
  'invitation.accept': '接受邀请',
  'user.create': '管理员创建用户',
  'user.update': '更新用户资料或角色',
  'user.disable': '停用账号',
  'user.enable': '恢复账号',
  'user.revoke-sessions': '撤销登录会话',
  'member.roles': '调整项目角色',
} satisfies Record<AuditAction, string>

export function isAuditAction(action: string): action is AuditAction {
  return Object.hasOwn(AUDIT_ACTION_LABELS, action)
}
