import type { AuditAction, AuditEvent } from '../../shared/audit/events'
import { AUDIT_ACTION_LABELS } from '../../shared/audit/events'
import type { Database, Transaction } from '../../server/db/client'
import { writeAudit } from '../../server/services/audit'

// 由 pnpm typecheck 编译验证，不执行数据库调用。
// 若写入类型被放宽，下方 @ts-expect-error 会因不再产生错误而使检查失败。
export function auditTypeChecks(tx: Transaction, db: Database) {
  const target = { projectId: 'project_main', actorId: 'admin', targetId: 'user_1', subjectUserId: 'user_1' }
  const disabled: AuditEvent = { ...target, action: 'user.disable', detail: { reason: '离开团队' } }
  void writeAudit(tx, disabled)
  void writeAudit(tx, { ...target, action: 'request.submit', detail: { source: 'registration' } })
  void writeAudit(tx, { ...target, action: 'request.approve', detail: { roles: ['developer', 'qa'], note: '已确认' } })
  void writeAudit(tx, { ...target, action: 'user.revoke-sessions', detail: {} })
  void writeAudit(tx, { ...target, action: 'user.create', detail: { name: '新同事', username: 'colleague', email: 'colleague@example.com', systemRole: 'user', projectRoles: ['qa'] } })
  // @ts-expect-error 创建用户的审计详情不允许记录密码。
  void writeAudit(tx, { ...target, action: 'user.create', detail: { name: '新同事', username: 'colleague', email: 'colleague@example.com', systemRole: 'user', projectRoles: [], password: 'not-a-real-password' } })

  // @ts-expect-error 拼错的动作不允许写入。
  void writeAudit(tx, { ...target, action: 'user.disbale', detail: { reason: '离开团队' } })
  // @ts-expect-error 停用事件必须包含原因字段。
  void writeAudit(tx, { ...target, action: 'user.disable', detail: {} })
  // @ts-expect-error 原因必须是字符串。
  void writeAudit(tx, { ...target, action: 'user.disable', detail: { reason: 123 } })
  // @ts-expect-error 批准申请不能使用停用账号的详情。
  void writeAudit(tx, { ...target, action: 'request.approve', detail: { reason: '已确认' } })
  // @ts-expect-error 项目角色必须来自已定义的角色集合。
  void writeAudit(tx, { ...target, action: 'request.approve', detail: { roles: ['root'], note: '' } })
  // @ts-expect-error 注册来源详情只适用于首次提交，不适用于修改说明。
  void writeAudit(tx, { ...target, action: 'request.update', detail: { source: 'registration' } })
  // @ts-expect-error 撤销会话事件不接受额外详情字段。
  void writeAudit(tx, { ...target, action: 'user.revoke-sessions', detail: { token: 'not-a-real-token' } })
  // @ts-expect-error 必须明确项目，公共写入方法不隐式选择项目。
  void writeAudit(tx, { actorId: 'admin', targetId: 'user_1', subjectUserId: 'user_1', action: 'user.disable', detail: { reason: '离开团队' } })
  // @ts-expect-error 必须传入业务事务，不能传入普通数据库连接绕开事务。
  void writeAudit(db, disabled)

  const unpairedAction: 'user.disable' | 'request.approve' = Math.random() > 0.5 ? 'user.disable' : 'request.approve'
  // @ts-expect-error 动作和详情必须成对，不能分别取任意联合类型。
  void writeAudit(tx, { ...target, action: unpairedAction, detail: { reason: '离开团队' } })

  const labels: Record<AuditAction, string> = AUDIT_ACTION_LABELS
  void labels
  // @ts-expect-error 中文名称必须覆盖所有已定义动作。
  const incompleteLabels: Record<AuditAction, string> = { 'user.disable': '停用账号' }
  void incompleteLabels
}
