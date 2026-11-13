import { describe, expect, it } from 'vitest'
import { searchRequirements } from '../../app/utils/requirement-search'
import { emptyRecentRequirements, mergeRecentRequirements, parseRecentRequirements } from '../../app/utils/recent-requirements'
import type { BoardRequirement } from '../../app/types/requirement-board'

const item = (id: string, key: string, title: string): BoardRequirement => ({
  id, key, title, priority: 'high', createdAt: '2026-09-25', updatedAt: '2026-09-25',
  status: { id: 'doing', name: '进行中', color: 'blue' }, assigneeIds: [], assignees: [], reporter: { id: 'u', name: 'admin', avatarColor: 'red' },
})
describe('需求候选与最近浏览', () => {
  const items = [item('a', 'REQ-7', '付款数据分类'), item('b', 'REQ-71', '付款列表'), item('c', 'REQ-3', '完善付款统计'), item('d', 'REQ-4', 'EDITOR API')]
  it('一个中文字符、编号不同写法、多词和大小写；仅匹配编号与名称', () => {
    expect(searchRequirements(items, '付')).toHaveLength(3)
    expect(searchRequirements(items, 'req7').map(item => item.id)).toEqual(['a', 'b'])
    expect(searchRequirements(items, 'REQ-7 分类').map(item => item.id)).toEqual(['a'])
    expect(searchRequirements(items, 'editor api').map(item => item.id)).toEqual(['d'])
    for (const query of ['admin', 'doing', '进行中', 'high']) expect(searchRequirements(items, query)).toHaveLength(0)
  })
  it('完全编号优先于前缀，名称前缀优先于包含，同档按最近访问排序', () => {
    expect(searchRequirements(items, 'req7', [{ id: 'b', visitedAt: 100 }]).map(item => item.id)).toEqual(['a', 'b'])
    expect(searchRequirements(items, '付款', [{ id: 'c', visitedAt: 200 }, { id: 'b', visitedAt: 100 }]).map(item => item.id)).toEqual(['b', 'a', 'c'])
  })
  it('并发合并去重、限 20 条；清空水位阻止其他标签页复活旧记录', () => {
    const all = { version: 1 as const, clearedAt: 0, entries: Array.from({ length: 30 }, (_, i) => ({ id: String(i), visitedAt: i + 1 })) }
    const merged = mergeRecentRequirements(all, { version: 1, clearedAt: 0, entries: [{ id: '1', visitedAt: 100 }] })
    expect(merged.entries).toHaveLength(20)
    expect(merged.entries[0]).toEqual({ id: '1', visitedAt: 100 })
    expect(mergeRecentRequirements(merged, { version: 1, clearedAt: 100, entries: [] }).entries).toEqual([])
    expect(mergeRecentRequirements({ version: 1, clearedAt: 100, entries: [] }, { version: 1, clearedAt: 0, entries: [{ id: 'fresh', visitedAt: 101 }] }).entries).toHaveLength(1)
  })
  it('损坏或未知版本记录安全降级，并剥离正文等额外字段', () => {
    expect(parseRecentRequirements('invalid')).toEqual(emptyRecentRequirements())
    expect(parseRecentRequirements('{"version":2,"entries":[]}')).toEqual(emptyRecentRequirements())
    expect(parseRecentRequirements(JSON.stringify({ version: 1, entries: [{ id: 'a', visitedAt: 5, title: '不持久化', body: '正文' }, null, { id: false }] })).entries).toEqual([{ id: 'a', visitedAt: 5 }])
  })
})
