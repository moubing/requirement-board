import { describe, expect, it } from 'vitest'
import { accountAuditLabel, accountAuditSummary } from '../../app/utils/account-audit'
import type { AccountAudit } from '../../shared/auth/access'

function event(action: string, detail: AccountAudit['detail'] = {}): AccountAudit {
  return { id: 'audit_example', action, detail, actorName: '测试同事', createdAt: '2026-09-05T11:55:20.000Z' }
}

describe('account audit display', () => {
  it('distinguishes the two legacy application records without rewriting them', () => {
    const registration = event('request.submit', { source: 'registration' })
    const update = event('request.submit', { previousStatus: 'pending', previousReviewNote: '', message: '222' })

    expect(accountAuditLabel(registration)).toBe('注册并提交加入申请')
    expect(accountAuditLabel(update)).toBe('更新申请说明')
    expect(accountAuditSummary(update)).toBe('申请说明：222')
    expect(update).toEqual(event('request.submit', { previousStatus: 'pending', previousReviewNote: '', message: '222' }))
  })

  it.each(['request.submit', 'request.resubmit'])('labels reapplications recorded as %s', (action) => {
    expect(accountAuditLabel(event(action, { previousStatus: 'rejected' }))).toBe('重新提交加入申请')
  })

  it('shows both values of a changed note and explicitly shows clearing it', () => {
    const update = event('request.update', { previousMessage: '222', message: '来自研发团队' })
    expect(accountAuditLabel(update)).toBe('更新申请说明')
    expect(accountAuditSummary(update)).toBe('申请说明：222 → 来自研发团队')
    expect(accountAuditSummary(event('request.update', { previousMessage: '', message: '222' })))
      .toBe('申请说明：（未填写） → 222')
    expect(accountAuditSummary(event('request.update', { previousMessage: '222', message: '' })))
      .toBe('申请说明：222 → （已清空）')
  })

  it('does not invent a previous note for historical updates', () => {
    expect(accountAuditSummary(event('request.submit', { previousStatus: 'pending', message: '' })))
      .toBe('申请说明：（已清空）')
  })

  it('keeps ordinary submissions and approval details readable', () => {
    expect(accountAuditLabel(event('request.submit', { previousStatus: null }))).toBe('提交加入申请')
    expect(accountAuditLabel(event('request.submit'))).toBe('提交加入申请')
    expect(accountAuditLabel(event('request.approve'))).toBe('批准加入申请')
    expect(accountAuditSummary(event('request.approve', { roles: ['developer', 'qa'] })))
      .toBe('项目角色：开发、测试')
    expect(accountAuditLabel(event('future.action'))).toBe('账号操作')
  })

  it('does not interpret object prototype properties as known audit actions', () => {
    for (const action of ['constructor', 'toString', '__proto__']) {
      expect(accountAuditLabel(event(action))).toBe('账号操作')
    }
  })
})
