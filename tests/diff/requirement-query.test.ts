import { describe, expect, it } from 'vitest'
import { requirementFilterSchema, requirementPageQuerySchema, requirementSearchQuerySchema, requirementSummariesQuerySchema } from '../../shared/requirements/query'
import { compareRequirementText, normalizeRequirementNumber, normalizeRequirementSearch,
  orderRequirementAssignees, requirementAssigneeSortText, requirementMatchScore } from '../../shared/requirements/search'

describe('文档查询契约', () => {
  it('分页只接受整数和完整排序，拒绝重复参数、越界与未知过滤项', () => {
    expect(requirementPageQuerySchema.parse({})).toEqual({ q: '', page: 1, pageSize: 20 })
    expect(requirementPageQuerySchema.parse({ page: '2', pageSize: '100', sortBy: 'assignees', sortOrder: 'desc' }))
      .toMatchObject({ page: 2, pageSize: 100, sortBy: 'assignees' })
    for (const value of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: ['1', '2'] },
      { page: true }, { page: '' }, { page: '1e3' }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
      { pageSize: 101 }, { sortBy: 'email' }, { sortOrder: 'desc' }, { projectId: 'other' }, { q: 'a'.repeat(241) }]) {
      expect(requirementPageQuerySchema.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
    expect(requirementFilterSchema.safeParse({ page: 2 }).success).toBe(false)
  })
  it('摘要指定范围与最近顺序最多二十项，重复 ID 只查询一次', () => {
    expect(requirementSummariesQuerySchema.parse({ ids: 'a,b,a' })).toEqual({ ids: ['a', 'b'] })
    expect(requirementSearchQuerySchema.parse({ q: ' a ', recentIds: ['b', 'a', 'b'] }))
      .toEqual({ q: 'a', limit: 20, recentIds: ['b', 'a'] })
    for (const value of [{}, { ids: [] }, { ids: '' }, { ids: ['a', ''] }, { ids: Array.from({ length: 21 }, (_, i) => String(i)) }]) {
      expect(requirementSummariesQuerySchema.safeParse(value).success).toBe(false)
    }
    expect(requirementSearchQuerySchema.safeParse({ limit: 21 }).success).toBe(false)
  })
  it('搜索保留 NFKC、Unicode 小写、编号分隔符及多词全部命中', () => {
    expect(normalizeRequirementSearch('\ufeff ＥＤＩＴＯＲ ΟΣ \u1680')).toBe('editor ος')
    expect(normalizeRequirementNumber(' ＲＥＱ＿ ７ ')).toBe('req7')
    const document = { key: 'REQ-7', title: '\ufeff付款 ＡＰＩ ΟΣ 100%_path\\file' }
    expect(requirementMatchScore(document, 'req7')).toBe(0)
    expect(requirementMatchScore(document, 'REQ_7 api')).toBe(3)
    expect(requirementMatchScore(document, '付款 api')).toBe(2)
    expect(requirementMatchScore(document, 'ος')).toBe(3)
    expect(requirementMatchScore(document, '%_path\\file')).toBe(3)
    expect(requirementMatchScore(document, 'api missing')).toBe(-1)
  })
  it('显示名按稳定码点排序，负责人使用全部姓名与 ID，包含补充平面字符', () => {
    expect(['😀', '\ue000', 'a', 'A', '中'].sort(compareRequirementText)).toEqual(['A', 'a', '中', '\ue000', '😀'])
    const people = [{ id: 'z', name: '李' }, { id: 'b', name: 'Alice' }, { id: 'a', name: 'Alice' }]
    expect(orderRequirementAssignees(people).map(person => person.id)).toEqual(['a', 'b', 'z'])
    expect(people[0]!.id).toBe('z')
    expect(requirementAssigneeSortText(people)).toBe('Alice、Alice、李')
    expect(requirementAssigneeSortText([])).toBe('')
  })
})
