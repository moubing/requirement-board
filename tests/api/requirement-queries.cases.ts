import { $fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { requirements, requirementAssignees, users } from '../../server/db/schema'
import { groupRequirements, listRequirementPage, readRequirementSummaries } from '../../server/services/requirement-queries'
import { requirementPageQuerySchema, type RequirementPage, type RequirementSearchResult, type RequirementSummariesResult, type RequirementGroups } from '../../shared/requirements/query'
import { compareRequirementText, requirementAssigneeSortText, requirementMatchScore } from '../../shared/requirements/search'
import { DOCUMENT_TYPE_LABELS } from '../../shared/documents/workflow'
import { TEST_DATABASE_URL, seedIds } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerRequirementQueryTests({ apiFetch }: { apiFetch: Api }) {
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const time = new Date('2026-10-01T12:00:00Z')
  const row = (number: number, extra: Partial<typeof requirements.$inferInsert> = {}) => ({
    id: `query_${String(number).padStart(3, '0')}`, projectId: seedIds.projectId, key: `REQ-${number}`,
    title: `查询文档 ${number}`, statusId: seedIds.backlogStatusId, reporterId: seedIds.currentUserId,
    priority: 'medium', createdAt: time, updatedAt: time, ...extra,
  })
  const page = (db: ReturnType<typeof createDatabase>['db'], query: Record<string, unknown> = {}) =>
    listRequirementPage(db, seedIds.projectId, seedIds.currentUserId, requirementPageQuerySchema.parse(query))

  describe('文档分页与查询基础', () => {
    it('数据库分页返回真实总数、数值编号顺序和空末页，多个负责人不重复计数', async () => {
      await database(async db => {
        await db.insert(requirements).values(Array.from({ length: 45 }, (_, i) => row(i + 1)))
        await db.insert(requirements).values(row(99, { projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId }))
        await db.insert(requirementAssignees).values([
          { requirementId: 'query_045', userId: seedIds.currentUserId },
          { requirementId: 'query_045', userId: seedIds.designUserId },
        ])
        const first = await page(db)
        expect(first).toMatchObject({ total: 45, page: 1, pageSize: 20 })
        expect(first.items.map(item => item.key)).toEqual(Array.from({ length: 20 }, (_, i) => `REQ-${45 - i}`))
        expect(first.items[0]!.assignees).toHaveLength(2)
        expect(first.items[0]!.reporter).not.toHaveProperty('email')
        expect(first.items[0]).not.toHaveProperty('contentJson')
        expect(first.items[0]).not.toHaveProperty('projectId')
        expect((await page(db, { page: 3 })).items).toHaveLength(5)
        expect(await page(db, { page: 4 })).toMatchObject({ items: [], total: 45, page: 4 })
        expect(await page(db, { q: '没有这个标题' })).toMatchObject({ items: [], total: 0, page: 1 })
        expect(await page(db, { assignee: 'me' })).toMatchObject({ total: 1 })
        expect(await page(db, { assignee: 'unassigned' })).toMatchObject({ total: 44 })
        expect(await page(db, { assignee: seedIds.designUserId, excludeId: 'query_045' })).toMatchObject({ total: 0 })
      })
      const second = await apiFetch<RequirementPage>('/api/requirements', { query: { page: 2, pageSize: 20 } })
      expect(second).toMatchObject({ total: 45, page: 2, pageSize: 20 })
      expect(second.items.map(item => item.key)).toEqual(Array.from({ length: 20 }, (_, i) => `REQ-${25 - i}`))
    })

    it('服务端搜索与共享规则一致，处理全角、大小写、多词、空白和 LIKE 特殊字符', async () => {
      const rows = [row(7, { title: '付款数据分类' }), row(71, { title: '付款列表' }), row(3, { title: '完善付款统计' }),
        row(4, { title: 'ＥＤＩＴＯＲ API' }), row(5, { title: '\ufeffΟ\u03a3 接口\u1680' }), row(6, { title: '100%_path\\file' }),
        row(8, { title: '100X_pathZfile' }), row(9, { title: '\u1680付款 API\ufeff' })]
      await database(db => db.insert(requirements).values(rows))
      for (const q of ['付', 'ＲＥＱ＿７', 'REQ-7 分类', 'editor api', 'ΟΣ', 'ος', '%_path\\file', '%', '_path', '\\file', '付款 api', 'admin', '不存在', ' - ']) {
        const expected = rows.filter(item => requirementMatchScore(item, q) >= 0)
          .sort((a, b) => requirementMatchScore(a, q) - requirementMatchScore(b, q) || compareRequirementText(a.id, b.id)).map(item => item.id)
        const found = await apiFetch<RequirementSearchResult>('/api/requirements/search', { query: { q } })
        expect(found.items.map(item => item.id), q).toEqual(expected)
        expect(found.hasMore).toBe(false)
        const full = await database(db => page(db, { q }))
        expect(full.items.map(item => item.id), q).toEqual(expected)
      }
      expect(await apiFetch('/api/requirements/search', { query: { q: '   ' } })).toMatchObject({ items: [], hasMore: false })
    })

    it('快速检索按相关度优先、同级最近顺序、更新时间和稳定 ID，并限制返回数量', async () => {
      await database(db => db.insert(requirements).values([row(7, { title: '付款' }), row(71, { title: '付款一' }),
        row(72, { title: '付款二' }), row(3, { title: '补充付款' })]))
      const all = await apiFetch<RequirementSearchResult>('/api/requirements/search', { query: { q: '付款', recentIds: ['query_003', 'query_072', 'query_071'] } })
      expect(all.items.map(item => item.id)).toEqual(['query_072', 'query_071', 'query_007', 'query_003'])
      const exact = await apiFetch<RequirementSearchResult>('/api/requirements/search', { query: { q: 'req7', recentIds: ['query_071'], limit: 1 } })
      expect(exact.items.map(item => item.id)).toEqual(['query_007'])
      expect(exact.hasMore).toBe(true)
    })

    it('文本列使用显示名和完整负责人名单，数值编号与优先级使用各自排序规则', async () => {
      await database(async db => {
        await db.update(users).set({ name: 'Alice' }).where(eq(users.id, seedIds.currentUserId))
        await db.update(users).set({ name: 'Alice' }).where(eq(users.id, seedIds.designUserId))
        await db.update(users).set({ name: '张三' }).where(eq(users.id, seedIds.frontendUserId))
        await db.insert(requirements).values([
          row(2, { title: '😀标题', documentType: 'requirement', priority: 'high' }),
          row(10, { title: '\ue000标题', documentType: 'todo', priority: 'low', statusId: seedIds.progressStatusId, reporterId: seedIds.designUserId }),
          row(3, { title: 'ABC标题', documentType: 'defect', priority: 'medium', reporterId: seedIds.frontendUserId }),
          row(4, { title: 'ABC标题', documentType: 'instruction', priority: 'medium' }),
        ])
        await db.insert(requirementAssignees).values([
          { requirementId: 'query_002', userId: seedIds.currentUserId }, { requirementId: 'query_002', userId: seedIds.frontendUserId },
          { requirementId: 'query_010', userId: seedIds.currentUserId }, { requirementId: 'query_010', userId: seedIds.designUserId },
          { requirementId: 'query_003', userId: seedIds.frontendUserId },
        ])
        const all = (await page(db)).items
        const textValues = { title: (item: typeof all[number]) => item.title,
          documentType: (item: typeof all[number]) => DOCUMENT_TYPE_LABELS[item.documentType],
          status: (item: typeof all[number]) => item.status.name,
          assignees: (item: typeof all[number]) => requirementAssigneeSortText(item.assignees),
          reporter: (item: typeof all[number]) => item.reporter.name }
        for (const [sortBy, value] of Object.entries(textValues)) for (const sortOrder of ['asc', 'desc'] as const) {
          const expected = [...all].sort((a, b) => (sortOrder === 'asc' ? 1 : -1) * compareRequirementText(value(a), value(b)) || compareRequirementText(a.id, b.id))
          const found = await page(db, { sortBy, sortOrder, pageSize: 2 })
          const next = await page(db, { sortBy, sortOrder, pageSize: 2, page: 2 })
          expect([...found.items, ...next.items].map(item => item.id), sortBy + sortOrder).toEqual(expected.map(item => item.id))
        }
        expect((await page(db, { sortBy: 'key' })).items.map(item => item.key)).toEqual(['REQ-2', 'REQ-3', 'REQ-4', 'REQ-10'])
        expect((await page(db, { sortBy: 'priority', sortOrder: 'desc' })).items.map(item => item.priority)).toEqual(['high', 'medium', 'medium', 'low'])
        expect((await page(db, { sortBy: 'assignees' })).items[1]!.assignees.map(person => person.id)).toEqual([seedIds.designUserId, seedIds.currentUserId])
      })
    })

    it('分组计数复用列表过滤，统计全范围并保留零计数组', async () => {
      await database(async db => {
        await db.insert(requirements).values(Array.from({ length: 25 }, (_, i) => row(i + 1, { documentType: i % 2 ? 'todo' : 'defect', statusId: i < 10 ? seedIds.progressStatusId : seedIds.backlogStatusId })))
        const groups = await groupRequirements(db, seedIds.projectId, seedIds.currentUserId, { q: '' })
        expect(groups.total).toBe(25)
        expect(groups.groups.find(group => group.id === seedIds.backlogStatusId)?.count).toBe(15)
        expect(groups.groups.find(group => group.id === seedIds.progressStatusId)?.count).toBe(10)
        expect(groups.groups.some(group => group.count === 0)).toBe(true)
        expect(groups.groups.some(group => group.id === seedIds.otherStatusId)).toBe(false)
      })
      const groups = await apiFetch<RequirementGroups>('/api/requirements/groups', { query: { q: '查询', documentType: 'todo', statusId: seedIds.progressStatusId } })
      expect(groups.total).toBe(5)
      expect(groups.groups.reduce((total, group) => total + group.count, 0)).toBe(5)
      expect((await database(db => page(db, { q: '查询', documentType: 'todo', statusId: seedIds.progressStatusId }))).total).toBe(groups.total)
    })

    it('指定 ID 摘要明确确认范围，保留请求顺序，不泄漏跨项目文档或正文', async () => {
      await database(db => db.insert(requirements).values([row(1), row(99, { projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId })]))
      const created = await apiFetch('/api/requirements', { method: 'POST', body: { title: '查询文档 50', templateId: null } })
      const result = await apiFetch<RequirementSummariesResult>('/api/requirements/summaries', { query: { ids: [created.id, 'query_099', 'missing', 'query_001', created.id] } })
      expect(result).toMatchObject({ requestedIds: [created.id, 'query_099', 'missing', 'query_001'],
        unavailableIds: ['query_099', 'missing'], complete: true })
      expect(result.items.map(item => item.id)).toEqual([created.id, 'query_001'])
      expect(result.items.every(item => !('contentJson' in item) && !('email' in item.reporter))).toBe(true)
      await apiFetch(`/api/requirements/${created.id}`, { method: 'PATCH', body: { title: '已独立保存标题' } })
      const renamed = await database(db => readRequirementSummaries(db, seedIds.projectId, [created.id]))
      expect(renamed.items[0]!.title).toBe('已独立保存标题')
      expect((await apiFetch<RequirementSearchResult>('/api/requirements/search', { query: { q: '独立保存标题' } })).items[0]!.id).toBe(created.id)
    })

    it('查询入口保持会话与固定项目权限，并拒绝非法或越权范围参数', async () => {
      for (const path of ['/api/requirements', '/api/workbench/flow', '/api/workbench/activity', '/api/workbench/team-load', '/api/workbench/completions', '/api/requirements/search?q=文档', '/api/requirements/groups', '/api/requirements/summaries?ids=missing']) {
        await expect($fetch(path)).rejects.toMatchObject({ statusCode: 401 })
        await expect(apiFetch(path, { query: { projectId: seedIds.otherProjectId } })).rejects.toMatchObject({ statusCode: 400 })
      }
      for (const [path, query] of [
        ['/api/requirements', { page: 0 }], ['/api/requirements', { pageSize: 101 }],
        ['/api/requirements', { page: ['1', '2'] }], ['/api/requirements', { sortBy: 'unknown' }],
        ['/api/requirements/search', { limit: 21 }], ['/api/requirements/search', { q: ['a', 'b'] }],
        ['/api/requirements/search', { recentIds: Array(21).fill('a') }], ['/api/requirements/groups', { documentType: 'unknown' }],
        ['/api/requirements/summaries', {}], ['/api/requirements/summaries', { ids: '' }],
      ] as const) await expect(apiFetch(path, { query })).rejects.toMatchObject({ statusCode: 400 })
      await database(db => db.update(users).set({ banned: true }).where(eq(users.id, seedIds.currentUserId)))
      await expect(apiFetch('/api/requirements/groups')).rejects.toMatchObject({ statusCode: 403 })
    })
  })
}
