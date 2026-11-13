import type { AccountAudit, RequestStatus } from './access'

export function requestSubmissionAction(previousStatus: RequestStatus | null) {
  if (previousStatus === 'pending') return 'request.update'
  if (previousStatus) return 'request.resubmit'
  return 'request.submit'
}

export function resolveAccountAuditAction(event: Pick<AccountAudit, 'action' | 'detail'>) {
  // 旧记录统一使用 request.submit；只解释展示语义，不改写原始审计数据。
  if (event.action === 'request.submit') {
    const previousStatus = event.detail.previousStatus
    if (previousStatus === 'pending' || previousStatus === 'rejected' || previousStatus === 'approved') {
      return requestSubmissionAction(previousStatus)
    }
  }
  return event.action
}
