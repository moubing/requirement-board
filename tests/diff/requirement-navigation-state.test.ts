// @vitest-environment happy-dom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRequirementCache } from '../../app/composables/use-requirement-cache'
import { usePagedRequirements } from '../../app/composables/use-paged-requirements'
import { useRecentRequirements } from '../../app/composables/use-recent-requirements'
import type { RequirementSummary, RequirementPage } from '../../shared/requirements/query'

const item = (id: string): RequirementSummary => ({ id, documentType: 'requirement', key: `REQ-${id}`, title: `需求 ${id}`, priority: 'low',
  createdAt: '2026-09-25', updatedAt: '2026-09-25', status: { id: 's', code: 'draft', name: '待整理', color: '#aaa' }, assigneeIds: [], assignees: [],
  reporter: { id: 'one', name: '甲', avatarColor: '#aaa' } })
let wrapper: VueWrapper | undefined
let account = ref({ canAccessProject: true, user: { id: 'one' } })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  const states = new Map()
  account = ref({ canAccessProject: true, user: { id: 'one' } })
  fetcher = vi.fn(async (path, { query }) => path.endsWith('/summaries')
    ? { items: query.ids.map(item), requestedIds: query.ids, unavailableIds: [], complete: true, asOf: 'now' }
    : { items: [item('1'), item('2')], total: 30, page: query.page, pageSize: query.pageSize, asOf: 'now' })
  vi.stubGlobal('useState', (key: string, init: () => unknown) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key) })
  vi.stubGlobal('useAccountAccessState', () => account)
  vi.stubGlobal('useRequestFetch', () => fetcher)
  localStorage.clear()
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function setup() {
  let index!: ReturnType<typeof useRequirementCache>
  let page!: ReturnType<typeof usePagedRequirements>
  let recent!: ReturnType<typeof useRecentRequirements>
  const open = ref(false)
  wrapper = mount(defineComponent({ setup() {
    index = useRequirementCache(); recent = useRecentRequirements(() => open.value)
    page = usePagedRequirements('test:table', { q: '', page: 1, pageSize: 10 })
    return () => h('div')
  } }))
  return { index, recent, page, open }
}

it('同条件请求去重，途中多次失效顺序补读且不取消；换账号立即清空摘要和查询', async () => {
  let complete!: (data: RequirementPage) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const { index, page } = setup()
  const first = page.load(), duplicate = page.load()
  expect(fetcher).toHaveBeenCalledOnce()
  index.invalidate()
  index.invalidate()
  fetcher.mockResolvedValueOnce({ items: [item('3')], total: 1, page: 1, pageSize: 10 })
  const refreshed = page.refresh()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(false)
  complete({ items: [item('1')], total: 1, page: 1, pageSize: 10, asOf: 'now' }); await Promise.all([first, duplicate, refreshed])
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(page.items.value.map(row => row.id)).toEqual(['3'])
  index.setTitle('3', '已经独立保存的标题')
  expect(page.items.value[0]?.title).toContain('独立保存')
  account.value = { canAccessProject: true, user: { id: 'two' } }
  expect(page.items.value).toEqual([])
  expect(index.state.value.summaries).toEqual({})
  expect(index.state.value.titles).toEqual({})
})

it('刷新后的服务器标题覆盖旧缓存，退出账号取消未完成请求并丢弃响应', async () => {
  const { index, page } = setup()
  await page.load()
  index.setTitle('1', '原来的本机名称')
  fetcher.mockResolvedValueOnce({ items: [{ ...item('1'), title: '其他成员已改名' }], page: 1, pageSize: 10, total: 1 })
  await page.refresh()
  expect(page.items.value[0]?.title).toBe('其他成员已改名')
  let complete!: (value: unknown) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const pending = page.refresh()
  const signal = fetcher.mock.calls.at(-1)![1].signal
  account.value = { canAccessProject: false, user: { id: 'one' } }
  expect(signal.aborted).toBe(true)
  complete({ items: [item('2')], page: 1, pageSize: 10, total: 1 }); await pending
  expect(page.items.value).toEqual([])
})

it('最近浏览去重、storage 合并与清空同步，账号隔离且网络失败不删除记录', async () => {
  const { index, recent, open } = setup()
  recent.visit('1'); recent.visit('2'); recent.visit('1')
  expect(new Set(recent.entries.value.map(row => row.id)).size).toBe(2)
  const key = 'rb:recent-requirements:v1:one:project_main'
  const saved = JSON.parse(localStorage.getItem(key)!)
  expect(Object.keys(saved.entries[0]).sort()).toEqual(['id', 'visitedAt'])
  fetcher.mockRejectedValueOnce(new Error('offline'))
  open.value = true
  await recent.refresh(true); await flushPromises()
  expect(recent.entries.value).toHaveLength(2)
  const cleared = { version: 1, clearedAt: Date.now() + 100, entries: [] }
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(cleared) }))
  expect(recent.entries.value).toEqual([])
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify(saved) }))
  expect(recent.entries.value).toEqual([])
  account.value = { canAccessProject: true, user: { id: 'two' } }
  recent.visit('2')
  expect(recent.entries.value.map(row => row.id)).toEqual(['2'])
  account.value = { canAccessProject: false, user: { id: 'two' } }
  await flushPromises()
  expect(recent.entries.value).toEqual([])
  expect(index.state.value.summaries).toEqual({})
})

it('最近浏览只根据成功的指定 ID 完整确认清理，列表页或失败都不能删除记录', async () => {
  const { recent, page, open } = setup()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
  recent.visit('1'); recent.visit('2')
  await page.load({ q: '仅第三条', page: 1, pageSize: 10 })
  expect(recent.entries.value).toHaveLength(2)
  open.value = true
  await recent.refresh(); await flushPromises()
  expect(recent.items.value).toHaveLength(2)
  fetcher.mockResolvedValueOnce({ items: [item('2')], requestedIds: ['1', '2'], unavailableIds: ['1', 'unrequested'], complete: true, asOf: 'now' })
  await recent.refresh(true); await flushPromises()
  expect(recent.entries.value.map(row => row.id)).toEqual(['2'])
})

it('失败页保留成功页和页码，重试仍使用失败条件；合法越界最多补查一次', async () => {
  const { page } = setup()
  await page.load()
  fetcher.mockRejectedValueOnce(new Error('offline'))
  await page.load({ q: '', page: 2, pageSize: 10 })
  expect(page.committedQuery.value.page).toBe(1)
  expect(page.targetQuery.value.page).toBe(2)
  expect(page.items.value).toHaveLength(2)
  expect(page.error.value).toContain('重试')
  await page.retry()
  expect(page.committedQuery.value.page).toBe(2)
  fetcher.mockResolvedValueOnce({ items: [], total: 11, page: 5, pageSize: 10 })
    .mockResolvedValueOnce({ items: [item('11')], total: 11, page: 2, pageSize: 10 })
  const before = fetcher.mock.calls.length
  await page.load({ q: '', page: 5, pageSize: 10 })
  expect(fetcher.mock.calls.length - before).toBe(2)
  expect(page.committedQuery.value.page).toBe(2)
  expect(page.items.value.map(item => item.id)).toEqual(['11'])
})

it('快速换条件丢弃旧响应，空结果保持第一页；不同页和排序不共用结果', async () => {
  const { page } = setup()
  let finish!: (data: unknown) => void
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const old = page.load({ q: '旧词', page: 1, pageSize: 10 })
  const signal = fetcher.mock.calls[0]![1].signal
  fetcher.mockResolvedValueOnce({ items: [], total: 0, page: 3, pageSize: 20 })
  await page.load({ q: '新词', page: 3, pageSize: 20, sortBy: 'title', sortOrder: 'desc' })
  expect(signal.aborted).toBe(true)
  finish({ items: [item('old')], total: 1, page: 1, pageSize: 10 }); await old
  expect(page.items.value).toEqual([])
  expect(page.committedQuery.value).toMatchObject({ q: '新词', page: 1, pageSize: 20, sortOrder: 'desc' })
  await page.load({ q: '新词', page: 1, pageSize: 10, sortBy: 'title', sortOrder: 'asc' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('权限失败清空所有缓存且不自动重试，旧分页缓存不会覆盖较新的摘要标题', async () => {
  const { index, page } = setup()
  await page.load()
  index.remember([{ ...item('1'), title: '刚从其他查询取得的新标题', updatedAt: '2026-10-18T10:00:00Z' }])
  index.remember([{ ...item('1'), title: '较早请求的迟到结果' }])
  await page.load()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(page.items.value[0]?.title).toBe('刚从其他查询取得的新标题')
  index.state.value.generation = 3
  fetcher.mockRejectedValueOnce({ statusCode: 403 })
  await page.refresh(); await flushPromises()
  expect(page.items.value).toEqual([])
  expect(page.error.value).toContain('访问权限')
  expect(index.state.value.summaries).toEqual({})
  expect(fetcher).toHaveBeenCalledTimes(2)
})
