// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelEditorGeometry, scheduleEditorGeometry } from '../../app/components/editor/editor-geometry'
import { attachReadingAnchor } from '../../app/components/editor/reading-anchor'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT, EDITOR_READING_POSITION_RESTORED_EVENT } from '../../app/components/editor/editor-layout-events'

let frames: Map<number, FrameRequestCallback>
let sequence: number
let resize: ResizeObserverCallback
const disposals: (() => void)[] = []
function frame() {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach(callback => callback(0))
}
beforeEach(() => {
  frames = new Map(); sequence = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++sequence, callback); return sequence })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => {
  disposals.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('正文几何调度与阅读锚点', () => {
  it('同一帧合并调用方任务，全部测量完成后才写入，取消任务不再读取', () => {
    const root = document.createElement('div'), a = {}, b = {}, cancelled = {}
    const calls: string[] = []
    scheduleEditorGeometry(root, a, () => { calls.push('过期任务') })
    scheduleEditorGeometry(root, a, () => { calls.push('读 A'); return () => { calls.push('写 A') } })
    scheduleEditorGeometry(root, b, () => { calls.push('读 B'); return () => { calls.push('写 B') } })
    scheduleEditorGeometry(root, cancelled, () => { calls.push('取消任务') })
    cancelEditorGeometry(root, cancelled)
    expect(frames.size).toBe(1)
    frame()
    expect(calls).toEqual(['读 A', '读 B', '写 A', '写 B'])
  })

  it('文末输入只测量邻近段落，零宽度不覆盖位置，隐藏取消恢复', () => {
    const viewport = document.createElement('div'), root = document.createElement('div')
    viewport.append(root); document.body.append(viewport)
    let width = 600, scale = 1, reads = 0
    Object.defineProperty(viewport, 'clientWidth', { get: () => width })
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 200))
    for (let i = 0; i < 1000; i++) {
      const paragraph = document.createElement('p')
      paragraph.dataset.diffId = `p_${i}`
      paragraph.textContent = '正文'
      root.append(paragraph)
      vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => {
        reads++
        return new DOMRect(0, i * 20 * scale - viewport.scrollTop, width, 20 * scale)
      })
    }
    viewport.scrollTop = 19000
    const stop = vi.fn()
    const detach = attachReadingAnchor(root, viewport, stop)
    disposals.push(detach)
    frame()
    reads = 0
    root.dispatchEvent(new InputEvent('input'))
    frame()
    expect(reads).toBeLessThanOrEqual(3)
    width = 0
    resize([], {} as ResizeObserver)
    frame()
    expect(stop).not.toHaveBeenCalled()
    width = 400; scale = 2
    resize([], {} as ResizeObserver)
    frame()
    expect(viewport.scrollTop).toBe(38000)
    expect(stop).toHaveBeenCalledTimes(1)
    width = 500
    resize([], {} as ResizeObserver)
    detach(); frame()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  function readingFixture(suspended = () => false) {
    const viewport = document.createElement('div'), root = document.createElement('div')
    viewport.append(root); document.body.append(viewport)
    const layout = { width: 1190, scale: 1 }
    Object.defineProperty(viewport, 'clientWidth', { get: () => layout.width })
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, layout.width, 200))
    for (let i = 0; i < 200; i++) {
      const paragraph = document.createElement('p')
      paragraph.dataset.diffId = `p_${i}`
      root.append(paragraph)
      vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, i * 20 * layout.scale - viewport.scrollTop, layout.width, 20 * layout.scale))
    }
    const stop = vi.fn()
    disposals.push(attachReadingAnchor(root, viewport, stop, suspended))
    frame()
    // 与阅读位置恢复相同：同一正文几何队列中写入位置后派发事件。
    const restore = (top: number) => scheduleEditorGeometry(root, {}, () => () => {
      viewport.scrollTop = top
      viewport.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT))
    })
    return { viewport, root, layout, stop, restore }
  }

  it('恢复阅读位置后宽度立即变化，按恢复后的位置保持，不退回恢复前的旧锚点', () => {
    const { viewport, root, layout, restore } = readingFixture()
    expect(viewport.scrollTop).toBe(0)
    // 恢复任务先入队，锚点测量后入队：锚点在恢复前测得 0，写入阶段须作废。
    restore(800)
    root.dispatchEvent(new InputEvent('input'))
    frame()
    expect(viewport.scrollTop).toBe(800)
    // 细化测量执行前侧栏重新布局，正文变窄。
    layout.width = 830; layout.scale = 1.5
    resize([], {} as ResizeObserver)
    frame()
    expect(viewport.scrollTop).toBe(800)
  })

  it('恢复后宽度未变时细化为段落锚点，之后的宽度变化仍保持同一段落', () => {
    const { viewport, layout, restore } = readingFixture()
    restore(800)
    frame()
    frame()
    layout.width = 830; layout.scale = 1.5
    resize([], {} as ResizeObserver)
    frame()
    expect(viewport.scrollTop).toBe(1200)
  })

  it('字体换行而视口宽度不变时保持阅读段落，通知几何消费者且忽略无关配色', async () => {
    const { viewport, root, layout, stop, restore } = readingFixture()
    const changed = vi.fn()
    root.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, changed)
    restore(800); frame(); frame()
    layout.scale = 1.5
    document.documentElement.style.setProperty('--rb-editor-font-body', '"Arial",sans-serif')
    // 模拟同帧 scroll/input 先排入捕获任务，不能以换行后的段落覆盖旧锚点。
    root.dispatchEvent(new InputEvent('input'))
    await new Promise(resolve => setTimeout(resolve, 0))
    frame()
    expect(viewport.scrollTop).toBe(1200)
    expect(changed).toHaveBeenCalledOnce()
    document.documentElement.style.setProperty('--rb-editor-paragraph-color', '#123456')
    await new Promise(resolve => setTimeout(resolve, 0))
    frame()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('章节定位接管滚动时，已测量的旧锚点不再写入；到达后以新位置恢复阅读锚点', () => {
    let navigating = false
    const { viewport, root, layout, stop, restore } = readingFixture(() => navigating)
    restore(800); frame(); frame()
    // 模拟同一帧：宽度恢复已经测量，章节定位先写入，中间不能被旧位置打断。
    scheduleEditorGeometry(root, {}, () => () => { navigating = true; viewport.scrollTop = 900 })
    layout.width = 830; layout.scale = 1.5
    resize([], {} as ResizeObserver)
    frame()
    expect(viewport.scrollTop).toBe(900)
    expect(stop).not.toHaveBeenCalled()
    navigating = false
    restore(1800); frame(); frame()
    layout.width = 1000; layout.scale = 2
    resize([], {} as ResizeObserver)
    frame()
    expect(viewport.scrollTop).toBe(2400)
    expect(stop).toHaveBeenCalledOnce()
  })
})
