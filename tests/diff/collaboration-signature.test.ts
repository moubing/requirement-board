import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollaborationSignatureTracker } from '../../app/utils/collaboration-signature'

afterEach(() => vi.useRealTimers())

describe('协作保存签名调度', () => {
  it('同代 HTTP/WS 保存确认共用计算，旧确认不会重启已核对的全文签名', async () => {
    vi.useFakeTimers()
    let resolve!: (value: string) => void
    const compute = vi.fn(() => new Promise<string>(done => { resolve = done }))
    const publish = vi.fn()
    const tracker = createCollaborationSignatureTracker(compute, publish)
    tracker.changed()
    for (let i = 0; i < 20; i++) tracker.schedule()
    await vi.advanceTimersByTimeAsync(200)
    for (let i = 0; i < 20; i++) tracker.schedule()
    const completed = tracker.refresh()
    expect(compute).toHaveBeenCalledTimes(1)
    resolve('当前代次')
    await completed
    for (let i = 0; i < 20; i++) tracker.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenLastCalledWith('当前代次')
    tracker.destroy()
  })

  it('连续输入立即取消已保存标记，停顿后只计算一次最新签名', async () => {
    vi.useFakeTimers()
    let content = '已保存'
    let signature = '已保存'
    const compute = vi.fn(async () => content)
    const tracker = createCollaborationSignatureTracker(compute, next => { signature = next })
    for (let index = 0; index < 20; index++) {
      content += '字'
      tracker.changed()
      expect(signature).toBe('')
      await vi.advanceTimersByTimeAsync(35)
    }
    expect(compute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(signature).toBe(content)
    tracker.destroy()
  })

  it('服务端确认可以立即核对，期间新输入会使尚未完成的旧结果失效', async () => {
    vi.useFakeTimers()
    let resolveOld!: (value: string) => void
    let signature = ''
    const compute = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue('新内容')
    const tracker = createCollaborationSignatureTracker(compute, next => { signature = next })
    tracker.changed()
    const confirmation = tracker.refresh()
    expect(compute).toHaveBeenCalledTimes(1)
    tracker.changed()
    resolveOld('旧内容')
    await confirmation
    expect(signature).toBe('')
    await vi.advanceTimersByTimeAsync(200)
    expect(signature).toBe('新内容')
    tracker.destroy()
  })

  it('卸载取消待处理计算，也不再发布正在计算的结果', async () => {
    vi.useFakeTimers()
    let resolve!: (value: string) => void
    const compute = vi.fn(() => new Promise<string>(done => { resolve = done }))
    const publish = vi.fn()
    const tracker = createCollaborationSignatureTracker(compute, publish)
    const pending = tracker.refresh()
    tracker.changed()
    publish.mockClear()
    tracker.destroy()
    resolve('迟到的结果')
    await pending
    await vi.advanceTimersByTimeAsync(1000)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(publish).not.toHaveBeenCalled()
  })
})
