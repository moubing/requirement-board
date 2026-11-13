// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chapterLinkUrl, findChapterHeading } from '../../app/components/editor/chapter-link'
import { useRequirementChapterLink, type ChapterNavigator } from '../../app/composables/use-requirement-chapter-link'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))
const flush = async () => { await nextTick(); await nextTick(); await nextTick() }
function fixture(initial?: unknown) {
  const block = ref(initial), routeId = ref('doc'), active = ref(true), ready = ref(true)
  const go = vi.fn<ChapterNavigator['navigateToChapter']>().mockResolvedValue('reached')
  const navigator = { navigateToChapter: go }
  const showBody = vi.fn(), missing = vi.fn(async () => { block.value = undefined })
  let chapter!: ReturnType<typeof useRequirementChapterLink>
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ setup() {
    chapter = useRequirementChapterLink({ requirementId: 'doc', block: () => block.value, routeId: () => routeId.value,
      active: () => active.value, ready: () => ready.value, editor: () => navigator, showBody, missing })
    return () => h('div')
  } })
  app.mount(host)
  cleanups.push(() => { app.unmount(); host.remove() })
  return { block, routeId, active, ready, go, showBody, missing, chapter }
}

describe('章节链接与路由意图', () => {
  it('链接仅携带文档 ID 和稳定块 ID；特殊字符不会成为路径或查询', () => {
    const url = new URL(chapterLinkUrl('https://example.test', 'doc/#?', '标题 " ] & ='))
    expect(url.pathname).toBe('/requirements/doc%2F%23%3F')
    expect(url.searchParams.get('block')).toBe('标题 " ] & =')
    expect(url.hash).toBe('')
    const root = document.createElement('div')
    root.innerHTML = '<p data-diff-id="p">正文</p><h2>标题</h2>'
    root.querySelector('h2')!.dataset.diffId = 'unsafe"]id'
    expect(findChapterHeading(root, 'unsafe"]id')).toBe(root.querySelector('h2'))
    expect(findChapterHeading(root, 'p')).toBeNull()
  })
  it('首次定位一次，缓存返回不重播；同文档新 block 再定位', async () => {
    const f = fixture('heading-a'); await flush()
    expect(f.go).toHaveBeenCalledTimes(1)
    expect(f.chapter.pending.value).toBe(false)
    f.active.value = false; f.routeId.value = 'other'; await flush()
    f.active.value = true; f.routeId.value = 'doc'; await flush()
    expect(f.go).toHaveBeenCalledTimes(1)
    f.block.value = 'heading-b'; await flush()
    expect(f.go.mock.calls.map(call => call[0])).toEqual(['heading-a', 'heading-b'])
    expect(f.showBody).toHaveBeenCalledTimes(2)
  })
  it('无效/空 block 同样交给正文校验，只提示和清理一次', async () => {
    const f = fixture(undefined); await flush()
    f.go.mockResolvedValue('missing'); f.block.value = ''; await flush()
    expect(f.missing).toHaveBeenCalledTimes(1)
    expect(f.block.value).toBeUndefined()
    expect(f.chapter.pending.value).toBe(false)
  })
  it('等待协作正文期间点击/滚动会取消；恢复正文不抢位置', async () => {
    const f = fixture(undefined); await flush()
    f.ready.value = false; f.block.value = 'later'; await flush()
    expect(f.chapter.pending.value).toBe(true)
    window.dispatchEvent(new Event('wheel'))
    f.ready.value = true; await flush()
    expect(f.go).not.toHaveBeenCalled()
    expect(f.chapter.pending.value).toBe(false)
  })
  it('新 block 取消旧定位，旧异步结果不能清除新请求或报错', async () => {
    const f = fixture(undefined); await flush()
    let finish!: (result: 'missing') => void
    f.go.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.block.value = 'slow'; await flush()
    const oldSignal = f.go.mock.calls[0]![1]
    f.block.value = 'new'; await flush()
    expect(oldSignal.aborted).toBe(true)
    finish('missing'); await flush()
    expect(f.missing).not.toHaveBeenCalled()
    expect(f.go.mock.calls.map(call => call[0])).toEqual(['slow', 'new'])
  })
})
