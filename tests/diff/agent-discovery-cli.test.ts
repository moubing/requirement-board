import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../skills/requirement-board/scripts/rb.mjs'

const origin = 'https://board.example'
const schema = { capabilitiesVersion: 9, capabilities: ['document_relations', 'paginated_search'] }
const page = (number = 1, total = 45, count = 20) => ({
  items: Array.from({ length: count }, (_, i) => ({ id: `req_${(number - 1) * 20 + i}` })),
  page: number, pageSize: 20, total, asOf: '2026-11-07T12:00:00.000Z',
})

describe('Skill 关联与分页命令', () => {
  beforeEach(() => {
    vi.stubEnv('RB_BASE_URL', origin)
    vi.stubEnv('RB_TOKEN', `rb_agent_${'a'.repeat(43)}`)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
  const output = () => JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])
  const mock = (result: unknown = []) => vi.spyOn(globalThis, 'fetch').mockImplementation(async url =>
    new Response(JSON.stringify(new URL(String(url)).pathname.endsWith('/schema') ? schema : result)))

  it('先核验能力，再以 GET/POST/DELETE 处理编号、ID 和同站链接，不读取或锁定正文', async () => {
    const fetch = mock([{ id: 'req_target', key: 'REQ-2', title: '说明', documentType: 'instruction' }])
    await main(['related', `${origin}/requirements/req_source`])
    expect(output()[0].documentUrl).toBe(`${origin}/requirements/req_target`)
    await main(['link', 'REQ-1', 'req_target', `${origin}/requirements/req_third`, 'REQ-4'])
    await main(['unlink', 'req_source', 'REQ-2'])
    const calls = fetch.mock.calls.filter(call => !(call[0] as URL).pathname.endsWith('/schema'))
    expect(calls.map(([url, options]) => [(url as URL).pathname, options!.method])).toEqual([
      ['/api/agent/v1/requirements/req_source/related', 'GET'],
      ['/api/agent/v1/requirements/REQ-1/related', 'POST'],
      ['/api/agent/v1/requirements/req_source/related/REQ-2', 'DELETE'],
    ])
    expect(JSON.parse(String(calls[1]![1]!.body))).toEqual({ documentIds: ['req_target', 'req_third', 'REQ-4'] })
    expect(calls[2]![1]!.body).toBeUndefined()
    expect(fetch.mock.calls.every(([, options]) => options!.redirect === 'error')).toBe(true)
  })

  it('全部目标与 --site 在任何请求前核对站点；不因相同编号而混用凭证', async () => {
    const fetch = mock()
    for (const args of [
      ['link', 'REQ-1', `${origin}/requirements/req_a`, 'https://other.example/requirements/req_b'],
      ['unlink', `${origin}/requirements/req_a`, 'REQ-2', '--site', 'https://other.example'],
      ['link', 'REQ-1', 'https://other.example/requirements/req_a'],
      ['link', 'REQ-1', 'not-a-document'],
    ]) await expect(main(args)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('添加输入先计数再去重，空输入、101 项和多余参数均拒绝', async () => {
    const fetch = mock()
    for (const args of [
      ['link', 'REQ-1'], ['link', 'REQ-1', ...Array(101).fill('REQ-2')],
      ['unlink', 'REQ-1', 'REQ-2', 'REQ-3'], ['related', 'REQ-1', '--page', '2'],
      ['list', '--page', '1', '--page', '2'], ['list', '--query', 'a', '--query', 'b'], ['list', '--limit', '20'],
    ]) await expect(main(args)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    await main(['link', 'REQ-1', ...Array(100).fill('REQ-2')])
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body)).documentIds).toHaveLength(100)
  })

  it.each([[1, 45, 20, true, 2], [2, 45, 20, true, 3], [3, 45, 5, false, null],
    [1, 0, 0, false, null], [4, 45, 0, false, null]] as const)('分页 %s/%s 明确返回下一页', async (number, total, count, hasMore, nextPage) => {
    const fetch = mock(page(number, total, count))
    await main(['list', '--page', String(number)])
    expect(output()).toMatchObject({ page: number, total, hasMore, nextPage, siteOrigin: origin })
    const query = (fetch.mock.calls[1]![0] as URL).searchParams
    expect(query.get('page')).toBe(String(number))
    expect(query.get('pageSize')).toBe('20')
  })

  it('默认第一页并完整传递组合过滤、特殊字符和排序，不自行丢弃条件', async () => {
    const fetch = mock(page())
    await main(['list', '--query', '退款 100%_path\\文件', '--document-type', 'defect', '--status-id', 'status_draft',
      '--assignee', 'me', '--reporter', 'user_b', '--stale', '--exclude-id', 'req_excluded', '--sort-by', 'title', '--sort-order', 'desc', '--page-size', '20'])
    expect(Object.fromEntries((fetch.mock.calls[1]![0] as URL).searchParams)).toEqual({
      page: '1', pageSize: '20', q: '退款 100%_path\\文件', documentType: 'defect', statusId: 'status_draft',
      assignee: 'me', reporter: 'user_b', stale: '1', excludeId: 'req_excluded', sortBy: 'title', sortOrder: 'desc',
    })
  })

  it('缺失能力、旧数组和损坏响应明确失败，不将截断结果报告为全部', async () => {
    const fetch = mock(page())
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ capabilitiesVersion: 8, capabilities: ['search'] })))
    await expect(main(['list'])).rejects.toThrow('paginated_search')
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ capabilitiesVersion: 9, capabilities: [] })))
    await expect(main(['link', 'REQ-1', 'REQ-2'])).rejects.toThrow('document_relations')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(schema))).mockResolvedValueOnce(new Response('[]'))
    await expect(main(['list'])).rejects.toThrow('旧版裸数组')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(schema))).mockResolvedValueOnce(new Response('{}'))
    await expect(main(['list'])).rejects.toThrow('分页响应无效')
    expect(console.log).not.toHaveBeenCalled()
  })

  it('分页失败保留失败页供显式重试；关联响应丢失不自动重放写入', async () => {
    const fetch = mock(page(2))
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(schema))).mockRejectedValueOnce(new Error('网络中断'))
    await expect(main(['list', '--page', '2', '--query', '退款'])).rejects.toThrow('网络中断')
    expect(console.log).not.toHaveBeenCalled()
    await main(['list', '--page', '2', '--query', '退款'])
    expect(String(fetch.mock.calls[1]![0])).toBe(String(fetch.mock.calls[3]![0]))
    fetch.mockClear()
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(schema))).mockRejectedValueOnce(new Error('响应丢失'))
    await expect(main(['link', 'REQ-1', 'REQ-2'])).rejects.toThrow('响应丢失')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
