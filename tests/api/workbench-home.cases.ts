import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { auditEvents, requirementEditEvents, requirementRevisions, requirements } from '../../server/db/schema'
import { FLOW_STATES, type WorkbenchActivityPage, type WorkbenchCompletions, type WorkbenchFlow, type WorkbenchTeamLoad } from '../../shared/workbench/home'
import type { RequirementPage } from '../../shared/requirements/query'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
const DAY = 86_400_000

export function registerWorkbenchHomeTests({ apiFetch }: { apiFetch: Api }) {
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const flow = () => apiFetch<WorkbenchFlow>('/api/workbench/flow')
  const total = async (query: Record<string, string>) => (await apiFetch<RequirementPage>('/api/requirements', { query: { ...query, pageSize: 1 } })).total
  async function create(title: string, assigneeIds: string[], documentType = 'requirement') {
    return (await apiFetch<{ id: string; key: string }>('/api/requirements', { method: 'POST', body: { title, documentType, templateId: null, assigneeIds } }))
  }
  async function move(id: string, statusId: string) {
    await apiFetch(`/api/requirements/${id}`, { method: 'PATCH', body: { statusId } })
  }
  /** 把文档的全部活动推到若干天前，模拟长时间没有进展。 */
  async function age(id: string, days: number) {
    const at = new Date(Date.now() - days * DAY)
    await database(async db => {
      await db.update(requirements).set({ createdAt: at, updatedAt: at }).where(eq(requirements.id, id))
      await db.update(auditEvents).set({ createdAt: at }).where(eq(auditEvents.targetId, id))
      await db.update(requirementEditEvents).set({ createdAt: at }).where(eq(requirementEditEvents.requirementId, id))
      await db.update(requirementRevisions).set({ createdAt: at }).where(eq(requirementRevisions.requirementId, id))
    })
  }

  describe('首页工作台', () => {
    it('工作流与关键数字只含我负责和等我验证的任务，数量与列表筛选一致', async () => {
      const { statuses } = await flow()
      const queued = await create('首页待处理', [seedIds.currentUserId])
      const doing = await create('首页进行中', [seedIds.currentUserId, seedIds.frontendUserId], 'defect')
      await move(doing.id, statuses.doing.id)
      const verify = await create('等我验证', [seedIds.frontendUserId], 'todo')
      await move(verify.id, statuses.testing.id)
      const done = await create('已完成不显示', [seedIds.currentUserId])
      await move(done.id, statuses.done.id)
      await create('说明不进入工作流', [seedIds.currentUserId], 'instruction')
      const others = await create('他人的文档', [seedIds.frontendUserId])

      const result = await flow()
      const ids = result.cards.map(card => card.id)
      expect(ids).toEqual(expect.arrayContaining([queued.id, doing.id, verify.id]))
      expect(ids).not.toContain(done.id)
      expect(ids).not.toContain(others.id)
      expect(result.cards.every(card => card.documentType !== 'instruction')).toBe(true)
      expect(result.cards.find(card => card.id === verify.id)).toMatchObject({ verify: true, mine: false, status: { code: 'testing' } })
      expect(result.cards.find(card => card.id === doing.id)).toMatchObject({ verify: false, mine: true, status: { code: 'doing' } })
      for (const code of FLOW_STATES) expect(result.counts[code]).toBe(await total({ assignee: 'me', statusId: statuses[code].id }))
      expect(result.counts.verify).toBe(await total({ reporter: 'me', statusId: statuses.testing.id }))
      expect(result.counts.verify).toBeGreaterThanOrEqual(1)
      expect(result.counts.stale).toBe(await total({ assignee: 'me', stale: '1' }))
      expect(Object.keys(result.statuses).sort()).toEqual(['queued', 'doing', 'testing', 'done', 'closed'].sort())
    })

    it('停滞按最近有效活动计算，仅改标题、负责人或优先级不重置，改状态重置', async () => {
      const { statuses } = await flow()
      const doc = await create('长时间没有进展', [seedIds.currentUserId])
      await move(doc.id, statuses.doing.id)
      await age(doc.id, 4)
      const stale = async () => (await flow()).cards.find(card => card.id === doc.id)!
      const before = await stale()
      expect(Date.now() - Date.parse(before.lastActivityAt)).toBeGreaterThan(4 * DAY - 60_000)
      const count = (await flow()).counts.stale
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBe(await total({ assignee: 'me', stale: '1' }))
      expect((await apiFetch<RequirementPage>('/api/requirements', { query: { assignee: 'me', stale: '1', pageSize: 100 } })).items.map(item => item.id)).toContain(doc.id)

      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { priority: 'high', assigneeIds: [seedIds.currentUserId, seedIds.frontendUserId] } })
      expect((await stale()).lastActivityAt).toBe(before.lastActivityAt)

      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { title: '仅重新命名，正文没有进展' } })
      expect((await stale()).lastActivityAt).toBe(before.lastActivityAt)
      expect((await flow()).counts.stale).toBe(count)
      expect(await total({ assignee: 'me', stale: '1' })).toBe(count)
      expect((await apiFetch<RequirementPage>('/api/requirements', { query: { assignee: 'me', stale: '1', pageSize: 100 } })).items.map(item => item.id)).toContain(doc.id)

      await move(doc.id, statuses.testing.id)
      expect(Date.now() - Date.parse((await stale()).lastActivityAt)).toBeLessThan(60_000)
      expect((await apiFetch<RequirementPage>('/api/requirements', { query: { assignee: 'me', stale: '1', pageSize: 100 } })).items.map(item => item.id)).not.toContain(doc.id)
    })

    it.each([
      { label: '空收据不重置', blockIds: [], countsAsActivity: false },
      { label: '正文编辑重置', blockIds: ['activity-body'], countsAsActivity: true },
      { label: '标题与正文混合编辑重置', blockIds: ['$title', 'activity-body'], countsAsActivity: true },
    ])('停滞编辑收据：$label', async ({ blockIds, countsAsActivity }) => {
      const { statuses } = await flow()
      const doc = await create('编辑活动口径', [seedIds.currentUserId])
      await move(doc.id, statuses.doing.id)
      await age(doc.id, 4)
      const before = await flow()
      const previous = before.cards.find(card => card.id === doc.id)!
      // 模拟历史编辑收据，包括旧客户端一次同时修改标题与正文的情况。
      await database(db => db.insert(requirementEditEvents).values({
        id: `edit_${nanoid(24)}`, requirementId: doc.id, sequence: 1, authorId: seedIds.currentUserId,
        authorName: 'Mo Bing', intent: 'edit', updateHash: 'activity-fixture', blockIds, changes: [],
      }))
      const after = await flow()
      const current = after.cards.find(card => card.id === doc.id)!
      if (countsAsActivity) expect(Date.now() - Date.parse(current.lastActivityAt)).toBeLessThan(60_000)
      else expect(current.lastActivityAt).toBe(previous.lastActivityAt)
      expect(after.counts.stale).toBe(before.counts.stale - Number(countsAsActivity))
      expect(await total({ assignee: 'me', stale: '1' })).toBe(after.counts.stale)
    })

    it('全项目动态合并五类事件，筛选、分页与「与我有关」正确，迁移日志不进入', async () => {
      const { statuses } = await flow()
      const doc = await create('动态来源', [])
      await move(doc.id, statuses.doing.id)
      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { assigneeIds: [seedIds.currentUserId] } })
      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { priority: 'low' } })
      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { title: '动态来源（改名）' } })
      await database(async db => {
        const v1 = await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, doc.id) })
        await db.insert(requirementRevisions).values({ ...v1!, id: `rev_${nanoid(12)}`, version: 2, clientSaveId: null, createdAt: new Date() })
        await db.insert(auditEvents).values({ id: `audit_${nanoid(16)}`, projectId: seedIds.projectId, actorId: seedIds.adminUserId, targetId: doc.id,
          action: 'requirement.property.change', detail: { field: 'statusId', label: '状态', before: { value: statuses.doing.id, label: '进行中' },
            after: { value: statuses.testing.id, label: '测试中' }, operationId: 'operation_migration_test', source: 'migration' } })
      })
      const all = await apiFetch<WorkbenchActivityPage>('/api/workbench/activity', { query: { limit: 50 } })
      const mine = all.items.filter(item => item.document.id === doc.id)
      expect(mine.map(item => item.kind)).toEqual(['revision', 'priority', 'assignee', 'status', 'create'])
      expect(mine.find(item => item.kind === 'status')).toMatchObject({ from: { label: '待处理', color: statuses.queued.color }, to: { label: '进行中', color: statuses.doing.color } })
      expect(mine.find(item => item.kind === 'assignee')).toMatchObject({ assignees: [{ id: seedIds.currentUserId }], mine: true })
      expect(mine.find(item => item.kind === 'revision')).toMatchObject({ version: 2 })
      expect(mine.every(item => item.mine)).toBe(true)
      for (const [kind, expected] of [['status', 'status'], ['assignee', 'assignee'], ['create', 'create'], ['revision', 'revision']] as const) {
        const page = await apiFetch<WorkbenchActivityPage>('/api/workbench/activity', { query: { kind, limit: 50 } })
        expect(page.items.length).toBeGreaterThan(0)
        expect(page.items.every(item => item.kind === expected)).toBe(true)
      }
      // 逐页读取与一次读取的顺序一致，没有重复或遗漏。
      const pages: string[] = []
      let cursor: string | null | undefined
      do {
        const page: WorkbenchActivityPage = await apiFetch('/api/workbench/activity', { query: { limit: 2, ...(cursor ? { cursor } : {}) } })
        pages.push(...page.items.map(item => item.id)); cursor = page.nextCursor
      } while (cursor && pages.length < 60)
      expect(pages.slice(0, all.items.length)).toEqual(all.items.map(item => item.id))
      await expect(apiFetch('/api/workbench/activity', { query: { cursor: 'invalid' } })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('团队负载每格与列表筛选条数一致，包含未指派行，多人负责各计一次', async () => {
      const { statuses } = await flow()
      await create('未指派任务', [])
      const shared = await create('两人负责', [seedIds.currentUserId, seedIds.frontendUserId])
      await move(shared.id, statuses.doing.id)
      const load = await apiFetch<WorkbenchTeamLoad>('/api/workbench/team-load')
      expect(load.rows[0]!.id).toBe(seedIds.currentUserId)
      expect(load.rows.at(-1)).toMatchObject({ id: 'unassigned', name: '未指派' })
      expect(load.statuses.map(status => status.code)).toEqual([...FLOW_STATES])
      for (const row of load.rows) for (const code of FLOW_STATES) {
        expect(row.counts[code]).toBe(await total({ assignee: row.id, statusId: statuses[code].id }))
      }
      expect(load.rows.at(-1)!.counts.queued).toBeGreaterThanOrEqual(1)
    })

    it('完成节奏只计最后一次进入已完成，已关闭与迁移不计，「我的」按完成时的负责人', async () => {
      const { statuses } = await flow()
      const reopened = await create('重新打开后再完成', [seedIds.currentUserId])
      await move(reopened.id, statuses.done.id)
      await move(reopened.id, statuses.doing.id)
      await move(reopened.id, statuses.done.id)
      const handedOver = await create('完成后改派', [seedIds.currentUserId])
      await move(handedOver.id, statuses.done.id)
      await apiFetch(`/api/requirements/${handedOver.id}`, { method: 'PATCH', body: { assigneeIds: [seedIds.frontendUserId] } })
      const others = await create('别人完成后改派给我', [seedIds.frontendUserId])
      await move(others.id, statuses.done.id)
      await apiFetch(`/api/requirements/${others.id}`, { method: 'PATCH', body: { assigneeIds: [seedIds.currentUserId] } })
      const closed = await create('已关闭', [seedIds.currentUserId])
      await move(closed.id, statuses.done.id)
      await move(closed.id, statuses.closed.id)
      const migrated = await create('迁移成已完成', [seedIds.currentUserId])
      await database(async db => {
        await db.update(requirements).set({ statusId: statuses.done.id }).where(eq(requirements.id, migrated.id))
        await db.insert(auditEvents).values({ id: `audit_${nanoid(16)}`, projectId: seedIds.projectId, actorId: seedIds.adminUserId, targetId: migrated.id,
          action: 'requirement.property.change', detail: { field: 'statusId', label: '状态', before: { value: statuses.queued.id, label: '待处理' },
            after: { value: statuses.done.id, label: '已完成' }, operationId: 'operation_migration_done', source: 'migration' } })
      })
      const lastDone = await database(db => db.query.auditEvents.findMany({ where: and(eq(auditEvents.targetId, reopened.id), eq(auditEvents.action, 'requirement.property.change')),
        orderBy: (log, { desc }) => [desc(log.createdAt)] }))

      const team = await apiFetch<WorkbenchCompletions>('/api/workbench/completions')
      expect(team.scope).toBe('team')
      expect(team.items.filter(item => item.id === reopened.id)).toHaveLength(1)
      expect(team.items.find(item => item.id === reopened.id)!.completedAt).toBe(lastDone[0]!.createdAt.toISOString())
      const teamIds = team.items.map(item => item.id)
      expect(teamIds).toEqual(expect.arrayContaining([reopened.id, handedOver.id, others.id]))
      expect(teamIds).not.toContain(closed.id)
      expect(teamIds).not.toContain(migrated.id)
      expect(team.items.every(item => item.date >= team.startDate && item.date <= team.today)).toBe(true)
      expect(team.dataStart <= team.today).toBe(true)

      const mine = (await apiFetch<WorkbenchCompletions>('/api/workbench/completions', { query: { scope: 'mine' } })).items.map(item => item.id)
      expect(mine).toEqual(expect.arrayContaining([reopened.id, handedOver.id]))
      expect(mine).not.toContain(others.id)
      await expect(apiFetch('/api/workbench/completions', { query: { scope: 'all' } })).rejects.toMatchObject({ statusCode: 400 })
    })
  })
}
