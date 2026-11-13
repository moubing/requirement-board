import { nanoid } from 'nanoid'
import type { AuditEvent } from '../../shared/audit/events'
import type { Transaction } from '../db/client'
import { auditEvents } from '../db/schema'

// 使用调用方的业务事务；失败向外抛出，让业务变更和审计一起回滚。
// 操作者和项目由已授权的服务端业务提供，创建时间使用数据库默认值。
export async function writeAudit(tx: Transaction, event: AuditEvent): Promise<void> {
  await tx.insert(auditEvents).values({
    id: `audit_${nanoid(16)}`,
    projectId: event.projectId,
    actorId: event.actorId,
    targetId: event.targetId,
    subjectUserId: event.subjectUserId,
    action: event.action,
    detail: event.detail,
  })
}
