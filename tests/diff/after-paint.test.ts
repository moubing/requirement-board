// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterNextPaint } from '../../app/utils/after-paint'

let frames: Map<number, FrameRequestCallback>
function frame() {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach(run => run(0))
}
beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  let id = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(run => { frames.set(++id, run); return id })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('重渲染前的输入反馈', () => {
  it('首个 rAF 之后仍留出绘制机会，第二帧执行且不被兜底重复调用', () => {
    const run = vi.fn()
    afterNextPaint(run)
    expect(run).not.toHaveBeenCalled()
    frame()
    expect(run).not.toHaveBeenCalled()
    frame()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(run).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })
  it('反向选择或卸载取消尚未提交的工作', () => {
    const old = vi.fn(), latest = vi.fn()
    const cancel = afterNextPaint(old)
    frame()
    cancel()
    afterNextPaint(latest)
    frame(); frame()
    vi.advanceTimersByTime(100)
    expect(old).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })
  it('隐藏页面或减少动态效果直接执行，不留下监听和定时器', () => {
    const run = vi.fn()
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    afterNextPaint(run)
    expect(run).toHaveBeenCalledTimes(1)
    vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    afterNextPaint(run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    expect(frames.size).toBe(0)
  })
  it('排队后转后台或 rAF 停止仍会完成，且只完成一次', () => {
    const run = vi.fn()
    afterNextPaint(run)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(run).toHaveBeenCalledTimes(1)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    afterNextPaint(run)
    vi.advanceTimersByTime(100)
    frame(); frame()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
