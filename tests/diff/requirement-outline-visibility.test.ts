// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequirementOutline } from '../../app/components/editor/use-requirement-outline'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from '../../app/components/editor/editor-layout-events'
import type { RichTextDocument } from '../../shared/editor/document'

vi.mock('gsap', () => ({ gsap: { matchMedia: () => ({ add() {}, revert() {} }) } }))
let frames: Map<number, FrameRequestCallback>
let frameId: number
let compact: boolean
let mediaListeners: Set<() => void>
let observerCallbacks: (() => void)[]
const cleanups: (() => void)[] = []

async function flushFrames() {
  await nextTick()
  await nextTick()
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach(callback => callback(0))
  await nextTick()
}

function fixture(enabledInitially = true, ignoreCompact = false) {
  const host = document.createElement('div')
  const viewport = document.createElement('div')
  const surface = document.createElement('div')
  const heading = document.createElement('h2')
  heading.dataset.diffId = 'heading'
  surface.append(heading)
  viewport.append(surface)
  document.body.append(viewport, host)
  const measurement = vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 20, 100, 30))
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 400))
  const enabled = ref(enabledInitially)
  const content = ref<RichTextDocument>({ type: 'doc', content: [{ type: 'heading', attrs: { diffId: 'heading', level: 2 }, content: [{ type: 'text', text: '标题' }] }] })
  let outline!: ReturnType<typeof useRequirementOutline>
  const app = createApp(defineComponent({ setup() {
    outline = useRequirementOutline({ enabled, ignoreCompact: ref(ignoreCompact), content, editor: shallowRef({ view: { dom: surface } } as Editor),
      getScrollController: () => ({ viewport, stop() {} }) })
    return () => h('div')
  } }))
  app.mount(host)
  const dispose = () => { app.unmount(); viewport.remove(); host.remove() }
  cleanups.push(dispose)
  function trigger() {
    viewport.dispatchEvent(new Event('scroll'))
    surface.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
    observerCallbacks.forEach(callback => callback())
    content.value = JSON.parse(JSON.stringify(content.value))
  }
  return { enabled, outline, measurement, trigger, content, viewport }
}

beforeEach(() => {
  frames = new Map(); frameId = 0; compact = false; mediaListeners = new Set(); observerCallbacks = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ get matches() { return compact },
    addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => mediaListeners.delete(listener),
  }) as unknown as MediaQueryList)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observerCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('目录可见性与测量', () => {
  it('普通段落输入和滚动复用标题几何；标题文字变化立即刷新目录', async () => {
    const f = fixture()
    await flushFrames()
    const items = f.outline.items.value
    f.measurement.mockClear()
    for (let i = 0; i < 20; i++) {
      f.content.value = { ...f.content.value, content: [f.content.value.content[0]!, { type: 'paragraph', content: [{ type: 'text', text: String(i) }] }] }
      f.viewport.dispatchEvent(new Event('scroll'))
      await flushFrames()
    }
    expect(f.outline.items.value).toBe(items)
    expect(f.measurement).not.toHaveBeenCalled()
    f.content.value = { type: 'doc', content: [{ type: 'heading', attrs: { diffId: 'heading', level: 2 }, content: [{ type: 'text', text: '新标题' }] }] }
    await flushFrames()
    expect(f.outline.items.value[0]!.label).toBe('新标题')
    expect(f.measurement).toHaveBeenCalledTimes(1)
  })

  it('辅助面板在窄屏展开时仍能定位目录，关闭后停止测量', async () => {
    compact = true
    const f = fixture(true, true)
    await flushFrames()
    expect(f.outline.activeIds.value).toEqual(['heading'])
    f.measurement.mockClear()
    f.enabled.value = false
    f.trigger()
    await flushFrames()
    expect(f.measurement).not.toHaveBeenCalled()
    expect(f.outline.items.value).toEqual([])
  })
  it('隐藏时不遍历目录或测量正文，显示后恢复激活项', async () => {
    const f = fixture(false)
    await flushFrames()
    f.trigger()
    await flushFrames()
    expect(f.measurement).not.toHaveBeenCalled()
    expect(f.outline.items.value).toEqual([])
    f.enabled.value = true
    await flushFrames()
    expect(f.measurement).toHaveBeenCalledTimes(1)
    expect(f.outline.activeIds.value).toEqual(['heading'])
  })

  it('隐藏会取消已排队的测量，后续滚动、布局和正文更新保持暂停', async () => {
    const f = fixture()
    await flushFrames()
    f.measurement.mockClear()
    f.trigger()
    f.enabled.value = false
    await flushFrames()
    f.trigger()
    await flushFrames()
    expect(f.measurement).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    f.enabled.value = true
    await flushFrames()
    expect(f.outline.activeIds.value).toEqual(['heading'])
  })

  it('窄屏初次挂载及断点往返都遵循实际目录可见状态', async () => {
    compact = true
    const f = fixture()
    await flushFrames()
    expect(f.measurement).not.toHaveBeenCalled()
    compact = false; mediaListeners.forEach(listener => listener())
    await flushFrames()
    expect(f.outline.activeIds.value).toEqual(['heading'])
    f.measurement.mockClear()
    compact = true; mediaListeners.forEach(listener => listener())
    f.trigger()
    await flushFrames()
    expect(f.measurement).not.toHaveBeenCalled()
    expect(f.outline.activeIds.value).toEqual([])
  })
})
