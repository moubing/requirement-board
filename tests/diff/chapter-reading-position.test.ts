// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BingScrollbarExpose } from '@moubing/bing-ui'
import { useRequirementReadingPosition } from '../../app/composables/use-requirement-reading-position'

let frames: Map<number, FrameRequestCallback>, frameId: number
const cleanups: (() => void)[] = []
beforeEach(() => {
  frames = new Map(); frameId = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const states = new Map([['requirement-reading-positions', ref({ 'user:doc': { top: 500, left: 0 } })], ['requirement-reading-owner', ref('user')]])
  vi.stubGlobal('useState', (key: string) => states.get(key))
  vi.stubGlobal('useAccountAccessState', () => ref({ user: { id: 'user' } }))
})
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function flush() {
  await nextTick(); await nextTick()
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0))
  await nextTick()
}
function mount(allowedInitially: boolean) {
  const allowed = ref(allowedInitially), active = ref(true)
  const viewport = document.createElement('div'), host = document.createElement('div')
  Object.defineProperties(viewport, { clientWidth: { value: 800 }, clientHeight: { value: 200 }, scrollHeight: { value: 2000 } })
  document.body.append(viewport, host)
  const app = createApp({ setup() {
    useRequirementReadingPosition(() => 'doc', ref({ viewport, stop() {} } as unknown as BingScrollbarExpose), () => active.value, () => viewport, () => allowed.value)
    return () => h('div')
  } })
  app.mount(host)
  cleanups.push(() => { app.unmount(); viewport.remove(); host.remove() })
  return { allowed, active, viewport }
}

it('没有章节意图时恢复阅读位置；章节定位优先且完成后不再补播旧位置', async () => {
  const regular = mount(true); await flush(); expect(regular.viewport.scrollTop).toBe(500)
  const chapter = mount(false); await flush(); expect(chapter.viewport.scrollTop).toBe(0)
  chapter.viewport.scrollTop = 1000; chapter.allowed.value = true; await flush()
  expect(chapter.viewport.scrollTop).toBe(1000)
  chapter.active.value = false; await flush(); chapter.viewport.scrollTop = 0
  chapter.active.value = true; await flush(); expect(chapter.viewport.scrollTop).toBe(1000)
})

it('新的章节意图取消已排队的阅读位置写入，随后取消章节也不会恢复旧位置', async () => {
  const f = mount(true)
  await nextTick(); await nextTick()
  f.allowed.value = false
  f.allowed.value = true
  await flush()
  expect(f.viewport.scrollTop).toBe(0)
})
