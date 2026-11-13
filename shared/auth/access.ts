export const PROJECT_ROLES = ['project_admin', 'product', 'developer', 'qa', 'designer', 'ops'] as const
export type ProjectRole = typeof PROJECT_ROLES[number]
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  project_admin: '项目管理员', product: '产品经理', developer: '开发',
  qa: '测试', designer: 'UI 设计', ops: '运维',
}
export type RequestStatus = 'pending' | 'approved' | 'rejected'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface AccountUser {
  id: string
  name: string
  email: string
  username: string | null
  role: string
  avatarColor: string
}
export interface AccessRequest {
  id: string
  status: RequestStatus
  message: string
  reviewNote: string
  reviewedAt: string | null
}
export interface AccountAccess {
  user: AccountUser
  canAccessProject: boolean
  projectRoles: ProjectRole[]
  request: AccessRequest | null
}
export interface ManagedUser extends AccountUser {
  banned: boolean
  banReason: string | null
  createdAt: string
  isMember: boolean
  projectRoles: ProjectRole[]
  requestStatus: RequestStatus | null
}
export interface Invitation {
  id: string
  name: string
  email: string
  roles: ProjectRole[]
  status: InvitationStatus
  expiresAt: string
  createdAt: string
}
export interface ManagedRequest extends AccessRequest {
  user: AccountUser
  createdAt: string
}
export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
}
export interface AccountAudit {
  id: string
  // 读取保留对历史及未知动作的兼容；新日志写入由 shared/audit/events.ts 约束。
  action: string
  actorName: string
  createdAt: string
  detail: Record<string, unknown>
}
