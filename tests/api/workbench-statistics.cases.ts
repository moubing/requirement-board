import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { requirementAssignees, requirementMilestoneAssignees, requirementMilestones, requirementStatisticCoverage, requirements, users } from '../../server/db/schema'
import { shanghaiDate, WORK_METRICS, type MyWorkStatistics } from '../../shared/statistics/workbench'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerWorkbenchStatisticsTests({ apiFetch }: { apiFetch: Api }) {
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  async function fixture(type: 'requirement' | 'defect', createdAt: string, code = 'queued') {
    const doc = await apiFetch('/api/requirements', { method: 'POST', body: { title: '统计证据', documentType: type, templateId: null,
      assigneeIds: [seedIds.currentUserId, seedIds.frontendUserId] } })
    await database(async db => {
      const status = await db.query.requirementStatuses.findFirst({ where: (s, { and, eq }) => and(eq(s.projectId, seedIds.projectId), eq(s.code, code)) })
      await db.update(requirements).set({ createdAt: new Date(createdAt), statusId: status!.id }).where(eq(requirements.id, doc.id))
      await db.update(requirementStatisticCoverage).set({ capturedFrom: new Date(createdAt), completeFrom: new Date(createdAt) }).where(eq(requirementStatisticCoverage.requirementId, doc.id))
    })
    return doc.id as string
  }
  async function event(id: string, kind: 'first_testing' | 'done', at: string, owners = [seedIds.currentUserId, seedIds.frontendUserId]) {
    await database(async db => {
      await db.insert(requirementMilestones).values({ requirementId: id, projectId: seedIds.projectId, kind, occurredAt: new Date(at), source: 'web', operationId: `test:${id}:${kind}` })
      if (owners.length) await db.insert(requirementMilestoneAssignees).values(owners.map(userId => ({ requirementId: id, kind, userId })))
    })
  }
  const get = (date = '2024-02-29', period = 'month') => apiFetch<MyWorkStatistics>('/api/workbench/my-work', { query: { date, period } })

  describe('工作台个人周期统计', () => {
    it('完整历史按事件负责人计数，日期含起不含终，汇总等于逐日；当前状态独立于周期', async () => {
      const requirement = await fixture('requirement', '2024-01-31T16:00:00Z', 'doing')
      await event(requirement, 'first_testing', '2024-02-28T16:00:00Z')
      await event(requirement, 'done', '2024-02-29T16:00:00Z') // 上海 3 月 1 日，排除在 2 月外
      const defect = await fixture('defect', '2024-02-28T15:59:59Z', 'testing')
      await event(defect, 'done', '2024-02-28T16:00:00Z')
      await fixture('defect', '2024-01-01T00:00:00Z', 'closed')
      await fixture('defect', '2024-01-01T00:00:00Z', 'done')
      const current = await fixture('defect', '2024-01-01T00:00:00Z', 'queued')
      // 旧产出归属不受当前改派、账号名称变化影响。
      await database(async db => {
        await db.delete(requirementAssignees).where(eq(requirementAssignees.requirementId, defect))
        await db.update(users).set({ name: '更名的共同负责人', banned: true }).where(eq(users.id, seedIds.frontendUserId))
      })
      const result = await get()
      expect(result.period).toMatchObject({ start: '2024-01-31T16:00:00.000Z', end: '2024-02-29T16:00:00.000Z', current: false })
      expect(result.days).toHaveLength(29)
      expect(WORK_METRICS.map(key => result.totals[key].value)).toEqual([1, 1, 0, 1, 1])
      for (const key of WORK_METRICS) {
        expect(result.totals[key].value).toBe(result.days.reduce((sum, day) => sum + day.values[key].value!, 0))
        expect(result.totals[key].knownValue).toBe(result.totals[key].value)
      }
      expect(result.days.at(-1)!.values.firstTestingRequirements.value).toBe(1)
      expect(result.current).toMatchObject({ developmentRequirements: 1, unfinishedDefects: 1 })
      expect(result.current.defects.reduce((sum, state) => sum + state.count, 0)).toBe(1)
      expect(result.current.defects.find(state => state.code === 'queued')!.count).toBe(1)
      expect(result.current.requirements).toHaveLength(3)
      const otherPeriod = await get('2024-03-01', 'week')
      expect(otherPeriod.current).toEqual(result.current)
      expect(otherPeriod.totals.completedRequirements.value).toBe(1)
      expect(current).toBeTruthy()
    })

    it('缺口只影响可能发生事件的区间，但不能用当前负责人排除未知；观察之后的日期可恢复完整', async () => {
      const legacy = await fixture('requirement', '2024-02-10T16:00:00Z')
      await database(async db => {
        await db.delete(requirementAssignees).where(eq(requirementAssignees.requirementId, legacy))
        await db.update(requirementStatisticCoverage).set({ historyComplete: false, completeFrom: null, gapReason: 'missing_initial_state',
          evidence: { type: 'legacy_without_initial_state', source: 'migration', operationId: null } }).where(eq(requirementStatisticCoverage.requirementId, legacy))
      })
      const before = await get()
      expect(before.days[9]!.values.firstTestingRequirements.value).toBe(0)
      expect(before.days[10]!.values.firstTestingRequirements).toMatchObject({ value: null, quality: 'incomplete', reason: 'missing_history' })
      expect(before.totals.firstTestingRequirements.value).toBeNull()
      expect(before.totals.createdRequirements.value).toBe(1)
      expect(before.totals.completedDefects.value).toBe(0)
      await database(db => db.update(requirementStatisticCoverage).set({ observedAt: new Date('2024-02-11T16:00:00Z'),
        completeFrom: new Date('2024-02-11T16:00:00.001Z'), observation: { statusCode: 'testing', assigneeIds: [], source: 'migration', operationId: null },
      }).where(eq(requirementStatisticCoverage.requirementId, legacy)))
      const observed = await get()
      expect(observed.days[11]!.values.firstTestingRequirements.value).toBeNull() // 观察当日仍有 1 ms 缺口
      expect(observed.days[12]!.values.firstTestingRequirements.value).toBe(0)
      expect(observed.totals.firstTestingRequirements).toMatchObject({ value: null, completeFrom: '2024-02-11T16:00:00.001Z' })
      expect((await get('2024-02-19', 'week')).totals.firstTestingRequirements).toMatchObject({ value: 0, quality: 'complete' })
    })

    it('项目和本人范围不可覆盖，空数据为零；未来日期为空且未来周期/非法参数拒绝', async () => {
      const foreign = await fixture('requirement', '2024-02-01T00:00:00Z')
      await database(async db => {
        // 外项目缺口不污染本项目；先删同项目受外键约束的派生证据。
        await db.delete(requirementStatisticCoverage).where(eq(requirementStatisticCoverage.requirementId, foreign))
        await db.update(requirements).set({ projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId }).where(eq(requirements.id, foreign))
      })
      const empty = await get()
      expect(WORK_METRICS.map(key => empty.totals[key].value)).toEqual([0, 0, 0, 0, 0])
      const current = await apiFetch<MyWorkStatistics>('/api/workbench/my-work', { query: { period: 'month' } })
      const today = shanghaiDate(current.asOf)
      for (const day of current.days) for (const key of WORK_METRICS) {
        expect(day.values[key]).toMatchObject(day.date > today ? { value: null, knownValue: null, quality: 'future' } : { value: 0, knownValue: 0, quality: 'complete' })
      }
      expect(current.period.observedUntil).toBe(current.asOf)
      for (const query of [{ date: '2999-01-01' }, { date: '2026-02-30' }, { userId: seedIds.frontendUserId }, { projectId: seedIds.otherProjectId }, { period: 'year' }]) {
        await expect(apiFetch('/api/workbench/my-work', { query, retry: 0 })).rejects.toMatchObject({ statusCode: 400 })
      }
      const owned = await fixture('requirement', '2024-02-01T00:00:00Z')
      await event(owned, 'first_testing', '2024-02-02T00:00:00Z', [])
      await database(db => db.update(requirements).set({ reporterId: seedIds.frontendUserId }).where(eq(requirements.id, owned)))
      const other = await get()
      expect(WORK_METRICS.map(key => other.totals[key].value)).toEqual([0, 0, 0, 0, 0])
    })

    it('旧文档历史缺口保留精确值未知，同时返回新文档已确认事件的逐日及周期下界', async () => {
      const legacy = await fixture('requirement', '2024-02-10T16:00:00Z')
      await database(db => db.update(requirementStatisticCoverage).set({ historyComplete: false, completeFrom: null, gapReason: 'missing_initial_state',
        evidence: { type: 'legacy_without_initial_state', source: 'migration', operationId: null } }).where(eq(requirementStatisticCoverage.requirementId, legacy)))
      const first = await fixture('requirement', '2024-02-01T00:00:00Z')
      await event(first, 'first_testing', '2024-02-09T00:00:00Z') // 缺口之前，精确计数。
      await event(first, 'done', '2024-02-13T00:00:00Z')
      const second = await fixture('requirement', '2024-02-12T00:00:00Z')
      await event(second, 'first_testing', '2024-02-13T00:00:00Z')
      await event(second, 'done', '2024-02-14T00:00:00Z')
      const otherOwner = await fixture('requirement', '2024-02-12T00:00:00Z')
      await event(otherOwner, 'first_testing', '2024-02-13T00:00:00Z', [seedIds.frontendUserId])

      const result = await get()
      expect(result.days[8]!.values.firstTestingRequirements).toMatchObject({ value: 1, knownValue: 1, quality: 'complete' })
      expect(result.days[10]!.values.firstTestingRequirements).toMatchObject({ value: null, knownValue: 0, quality: 'incomplete' })
      expect(result.days[12]!.values.firstTestingRequirements).toMatchObject({ value: null, knownValue: 1, quality: 'incomplete' })
      expect(result.days[12]!.values.completedRequirements).toMatchObject({ value: null, knownValue: 1, quality: 'incomplete' })
      expect(result.days[13]!.values.completedRequirements).toMatchObject({ value: null, knownValue: 1, quality: 'incomplete' })
      for (const metric of ['firstTestingRequirements', 'completedRequirements'] as const) {
        expect(result.totals[metric]).toMatchObject({ value: null, knownValue: 2, quality: 'incomplete' })
        expect(result.totals[metric].knownValue).toBe(result.days.reduce((sum, day) => sum + (day.values[metric].knownValue ?? 0), 0))
      }
    })
  })
}
