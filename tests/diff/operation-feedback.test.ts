import { describe, expect, it, vi } from 'vitest'
import type { BingToastService } from '@moubing/bing-ui'
import { createOperationFeedback } from '../../app/utils/operation-feedback'
import { createRetryableSubmission } from '../../app/utils/retryable-submission'
import { createLatestPatchQueue } from '../../app/utils/latest-patch-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
describe('主动操作反馈与并发选择', () => {
  it('同一提示从 loading 到结果，刷新失败不误报写入失败；关闭和换账号不复活旧提示', async () => {
    let scope = 'account-a:1'
    const messages = new Map<string, any>()
    const calls: any[] = []
    const service = Object.fromEntries(['loading', 'success', 'warning', 'error'].map(type => [type, (input: any) => {
      const id = input.id ?? `toast-${messages.size}`
      messages.set(id, { ...input, id, type }); calls.push({ ...input, id, type }); return id
    }])) as unknown as BingToastService
    service.getToasts = () => [...messages.values()]
    const feedback = createOperationFeedback(() => scope, service)
    const first = feedback.begin('正在保存 A')
    first.success('A 已保存')
    expect(messages.size).toBe(1)
    expect([...messages.values()][0]).toMatchObject({ type: 'success', position: 'top-center', duration: 2600 })
    await first.refresh(async () => { throw new Error('offline') })
    expect([...messages.values()][0]).toMatchObject({ type: 'warning', message: expect.stringContaining('操作已成功') })
    messages.clear(); first.error('不会重新出现')
    expect(messages.size).toBe(0)
    const second = feedback.begin('账号 A 的请求')
    scope = 'account-b:2'; messages.clear(); second.success('旧账号结果')
    scope = 'account-a:3'; second.error('旧会话结果')
    expect(messages.size).toBe(0)
    expect(calls.filter(call => call.type === 'loading').every(call => call.duration === 0)).toBe(true)
  })

  it('快速连续多选与跨字段提交串行合并，旧响应后仍保留最后选择', async () => {
    type Patch = { assigneeIds: string[]; priority: string }
    const first = deferred<Partial<Patch>>()
    const second = deferred<Partial<Patch>>()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const confirmed: Partial<Patch> = {}
    let pending: Partial<Patch> = {}
    const queue = createLatestPatchQueue<Patch, Partial<Patch>>({ send,
      confirmed: result => Object.assign(confirmed, result), changed: value => { pending = value } })
    const saving = queue.submit({ assigneeIds: ['a'] })
    await Promise.resolve()
    queue.submit({ assigneeIds: ['a', 'b'] })
    queue.submit({ priority: 'high' })
    queue.submit({ assigneeIds: ['b'] })
    expect(send).toHaveBeenCalledTimes(1)
    first.resolve({ assigneeIds: ['a'] })
    await Promise.resolve(); await Promise.resolve()
    expect(pending).toEqual({ assigneeIds: ['b'], priority: 'high' })
    expect(send).toHaveBeenLastCalledWith({ assigneeIds: ['b'], priority: 'high' })
    second.resolve({ assigneeIds: ['b'], priority: 'high' })
    await saving
    expect(confirmed).toEqual({ assigneeIds: ['b'], priority: 'high' })
    expect(pending).toEqual({})
  })

  it('失败保留选择可重试或取消，失败的旧提交不覆盖随后输入', async () => {
    const first = deferred<string>()
    let pending = {}, active = {}
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('latest').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('retry')
    const queue = createLatestPatchQueue<{ priority: string }, string>({ send, confirmed: vi.fn(), changed: (p, a) => { pending = p; active = a } })
    const saving = queue.submit({ priority: 'low' }); await Promise.resolve()
    queue.submit({ priority: 'high' }); first.reject(new Error('old failure'))
    await saving
    expect(send).toHaveBeenLastCalledWith({ priority: 'high' })
    await expect(queue.submit({ priority: 'medium' })).rejects.toThrow('offline')
    expect(pending).toEqual({ priority: 'medium' }); expect(active).toEqual({})
    await queue.submit(); expect(send).toHaveBeenLastCalledWith({ priority: 'medium' })
    send.mockRejectedValueOnce(new Error('offline'))
    await expect(queue.submit({ priority: 'low' })).rejects.toThrow()
    queue.cancel(); expect(pending).toEqual({})
  })

  it('按字段完成反馈，过期响应不结算新选择，其他字段失败也不抹掉已完成结果', async () => {
    type Patch = { assigneeIds: string[]; priority: string }
    const first = deferred<Partial<Patch>>()
    const second = deferred<Partial<Patch>>()
    const settled = vi.fn(), failed = vi.fn()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const queue = createLatestPatchQueue<Patch, Partial<Patch>>({ send, confirmed: vi.fn(), changed: vi.fn(), settled, failed })
    const saving = queue.submit({ assigneeIds: ['a'], priority: 'low' })
    await Promise.resolve()
    queue.submit({ priority: 'high' })
    first.resolve({ assigneeIds: ['a'], priority: 'low' })
    await Promise.resolve(); await Promise.resolve()
    expect(settled.mock.calls).toEqual([[{ assigneeIds: ['a'] }]])
    second.reject(new Error('offline'))
    await expect(saving).rejects.toThrow('offline')
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { priority: 'high' })
    expect(settled.mock.calls).toEqual([[{ assigneeIds: ['a'] }]])
    send.mockResolvedValueOnce({ priority: 'high' })
    await queue.submit()
    expect(settled).toHaveBeenLastCalledWith({ priority: 'high' })
  })

  it('超时重试固定请求标识和内容，明确拒绝或确认后才允许新提交', () => {
    const submission = createRetryableSubmission<{ title: string }>()
    const first = submission.capture({ title: '原提交' })
    submission.failed(new Error('timeout'))
    expect(submission.capture({ title: '原提交' })).toBe(first)
    expect(() => submission.capture({ title: '新输入' })).toThrow('上次提交结果尚未确认')
    submission.confirmed()
    expect(submission.capture({ title: '新输入' }).key).not.toBe(first.key)
    submission.failed({ statusCode: 422 })
    expect(submission.capture({ title: '修正输入' }).input.title).toBe('修正输入')
  })
})
