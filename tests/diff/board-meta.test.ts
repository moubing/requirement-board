// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useBoardMeta } from '../../app/composables/use-board-meta'

let wrapper: VueWrapper | undefined
let access = ref({ canAccessProject: true, user: { id: 'a' } })
let request = vi.fn()
beforeEach(() => {
  const app = {}, states = new Map()
  access = ref({ canAccessProject: true, user: { id: 'a' } })
  request = vi.fn(async () => ({ currentUserId: 'a', users: [], statuses: [], project: { id: 'project_main', name: '项目' } }))
  vi.stubGlobal('useNuxtApp', () => app)
  vi.stubGlobal('useAccountAccessState', () => access)
  vi.stubGlobal('useRequestFetch', () => request)
  vi.stubGlobal('useState', (key: string, init: () => unknown) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key) })
})
afterEach(() => { wrapper?.unmount(); vi.unstubAllGlobals() })
function setup() {
  let header!: ReturnType<typeof useBoardMeta>, page!: ReturnType<typeof useBoardMeta>
  wrapper = mount(defineComponent({ setup() { header = useBoardMeta(); page = useBoardMeta(); return () => h('div') } }))
  return { header, page }
}
it('Header 和页面共用一次元数据请求，读取缓存不会再次请求列表或元数据', async () => {
  const { header, page } = setup()
  await Promise.all([header.refresh(), page.refresh()])
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0]![0]).toBe('/api/meta')
  expect(header.data.value).toEqual(page.data.value)
  await header.refresh()
  expect(request).toHaveBeenCalledOnce()
})
it('失败保留上一份元数据与错误，重试恢复；权限失效立即清空且不请求', async () => {
  const { header } = setup()
  await header.refresh()
  request.mockRejectedValueOnce(new Error('offline'))
  await header.refresh(true)
  expect(header.error.value).toContain('重试')
  expect(header.data.value?.currentUserId).toBe('a')
  await header.refresh(true)
  expect(header.error.value).toBe('')
  access.value.canAccessProject = false
  expect(header.data.value).toBeNull()
  await header.refresh()
  expect(request).toHaveBeenCalledTimes(3)
})
it('切换账号取消旧请求，迟到响应不覆盖新范围', async () => {
  let finish!: (value: unknown) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { header } = setup()
  const old = header.refresh()
  const signal = request.mock.calls[0]![1].signal
  access.value.user.id = 'b'
  expect(signal.aborted).toBe(true)
  request.mockResolvedValueOnce({ currentUserId: 'b' })
  await header.refresh()
  finish({ currentUserId: 'a' }); await old
  expect(header.data.value?.currentUserId).toBe('b')
  expect(header.pending.value).toBe(false)
})
