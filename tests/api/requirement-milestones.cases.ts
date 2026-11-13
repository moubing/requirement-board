import { and, eq, sql } from 'drizzle-orm'
import { $fetch } from '@nuxt/test-utils/e2e'
import { nanoid } from 'nanoid'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { auditEvents, requirementMilestoneAssignees, requirementMilestones, requirementStatisticCoverage, requirements, users } from '../../server/db/schema'
import { createEmptyDocument } from '../../shared/editor/document'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerRequirementMilestoneTests({ apiFetch }: { apiFetch: Api }) {
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const create = (documentType = 'requirement', assigneeIds = [seedIds.currentUserId]) =>
    apiFetch('/api/requirements', { method: 'POST', body: { title: '里程碑验证', documentType, templateId: null, assigneeIds } })
  async function flow(id: string, codes: string[], extra: Record<string, unknown> = {}) {
    const statuses = await database(db => db.query.requirementStatuses.findMany())
    for (const code of codes) await apiFetch(`/api/requirements/${id}`, { method: 'PATCH', body: {
      statusId: statuses.find(status => status.projectId === seedIds.projectId && status.code === code)!.id,
      ...(code === codes.at(-1) ? extra : {}),
    } })
  }
  const events = (id: string) => database(db => db.query.requirementMilestones.findMany({ where: eq(requirementMilestones.requirementId, id) }))
  const owners = (id: string, kind = 'first_testing') => database(db => db.select({ userId: requirementMilestoneAssignees.userId }).from(requirementMilestoneAssignees)
    .where(and(eq(requirementMilestoneAssignees.requirementId, id), eq(requirementMilestoneAssignees.kind, kind as 'first_testing' | 'done'))))

  describe('可信里程碑与历史覆盖', () => {
    it('新建保存可信初值；同时改派与提测记录最终完整名单，退回再测和改名不改旧归属', async () => {
      const doc = await create()
      const initial = await database(db => db.query.requirementStatisticCoverage.findMany({ where: eq(requirementStatisticCoverage.requirementId, doc.id) }))
      expect(initial).toHaveLength(2)
      expect(initial.every(row => row.historyComplete && row.gapReason === null && row.completeFrom?.toISOString() === doc.createdAt)).toBe(true)
      expect(initial[0]!.evidence).toMatchObject({ type: 'creation', source: 'web', initialProperties: { assigneeIds: [seedIds.currentUserId], statusId: doc.statusId } })
      await flow(doc.id, ['doing', 'testing'], { assigneeIds: [seedIds.designUserId, seedIds.frontendUserId] })
      const first = await events(doc.id)
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ kind: 'first_testing', source: 'web' })
      expect((await owners(doc.id)).map(row => row.userId).sort()).toEqual([seedIds.designUserId, seedIds.frontendUserId].sort())
      const logs = await database(db => db.query.auditEvents.findMany({ where: eq(auditEvents.targetId, doc.id) }))
      expect(logs.filter(log => log.detail.operationId === first[0]!.operationId).map(log => log.detail.field).sort()).toEqual(['assigneeIds', 'statusId'])
      await flow(doc.id, ['doing', 'testing'], { assigneeIds: [seedIds.currentUserId] })
      await apiFetch(`/api/requirements/${doc.id}`, { method: 'PATCH', body: { title: '改名不影响里程碑' } })
      await database(db => db.update(users).set({ name: '更名后的设计人员', banned: true }).where(eq(users.id, seedIds.designUserId)))
      expect(await events(doc.id)).toEqual(first)
      expect((await owners(doc.id)).map(row => row.userId).sort()).toEqual([seedIds.designUserId, seedIds.frontendUserId].sort())
      await flow(doc.id, ['done'])
      expect((await events(doc.id)).map(row => row.kind).sort()).toEqual(['done', 'first_testing'])
      expect(await owners(doc.id, 'done')).toEqual([{ userId: seedIds.currentUserId }])
      await expect(database(db => db.insert(requirementMilestones).values(first[0]!))).rejects.toMatchObject({ cause: { code: '23505' } })
    })

    it('缺陷关闭不算完成，说明/待办不进入产出里程碑；完成时允许未指派', async () => {
      const defect = await create('defect', [])
      await flow(defect.id, ['doing', 'closed'])
      expect(await events(defect.id)).toEqual([])
      await flow(defect.id, ['queued', 'doing', 'testing', 'done'])
      expect(await events(defect.id)).toMatchObject([{ kind: 'done' }])
      expect(await owners(defect.id, 'done')).toEqual([])
      const instruction = await create('instruction'), todo = await create('todo')
      await flow(instruction.id, ['published'])
      await flow(todo.id, ['queued', 'doing', 'done'])
      expect(await events(instruction.id)).toEqual([])
      expect(await events(todo.id)).toEqual([])
      expect(await database(db => db.query.requirementStatisticCoverage.findMany({ where: eq(requirementStatisticCoverage.requirementId, todo.id) }))).toEqual([])
    })

    it('Agent 共用服务保存初值和来源，失败事务不留初值、里程碑、负责人或属性日志', async () => {
      const pat = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '里程碑验证' } })
      const agent = (path: string, body: unknown) => $fetch<any>(`/api/agent/v1/${path}`, {
        method: 'POST', body, headers: { authorization: `Bearer ${pat.token}` }, retry: 0,
      })
      const creation = { action: 'create', requestId: nanoid(24), title: 'Agent 创建的里程碑文档',
        contentJson: createEmptyDocument(), properties: { assigneeIds: [seedIds.frontendUserId] }, changeNote: '创建' }
      const created = await agent('operations', creation)
      const coverage = await database(db => db.query.requirementStatisticCoverage.findFirst({ where: eq(requirementStatisticCoverage.requirementId, created.requirementId) }))
      expect(coverage!.evidence).toMatchObject({ source: 'agent_takeover', operationId: creation.requestId })
      await flow(created.requirementId, ['doing'])
      const status = await database(db => db.query.requirementStatuses.findFirst({ where: sql`project_id = ${seedIds.projectId} and code = 'testing'` }))
      const previousLogs = await database(db => db.query.auditEvents.findMany({ where: eq(auditEvents.targetId, created.requirementId) }))
      const snapshot = await agent(`requirements/${created.requirementId}/snapshot`, {})
      const input = { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '里程碑改派与提测', operations: [],
        properties: { statusId: status!.id, assigneeIds: [seedIds.designUserId] } }
      await database(db => db.execute(sql`alter table requirement_milestone_assignees add constraint test_reject_milestone_owner check (user_id <> 'user_design')`))
      try { await expect(agent('operations', input)).rejects.toMatchObject({ statusCode: 500 }) }
      finally { await database(db => db.execute(sql`alter table requirement_milestone_assignees drop constraint test_reject_milestone_owner`)) }
      expect(await events(created.requirementId)).toEqual([])
      expect((await apiFetch(`/api/requirements/${created.requirementId}`)).assigneeIds).toEqual([seedIds.frontendUserId])
      expect(await database(db => db.query.auditEvents.findMany({ where: eq(auditEvents.targetId, created.requirementId) }))).toEqual(previousLogs)
      const applied = await agent('operations', input)
      expect(await agent('operations', input)).toEqual(applied)
      expect(await events(created.requirementId)).toMatchObject([{ source: 'agent_takeover', operationId: applied.id }])
      expect(await owners(created.requirementId)).toEqual([{ userId: seedIds.designUserId }])
      const coverageBefore = await database(db => db.select().from(requirementStatisticCoverage))
      await database(db => db.execute(sql`alter table requirement_revisions add constraint test_reject_milestone_creation check (title <> '回滚创建')`))
      try {
        await expect(apiFetch('/api/requirements', { method: 'POST', body: { title: '回滚创建', templateId: null }, retry: 0 })).rejects.toMatchObject({ statusCode: 500 })
      } finally { await database(db => db.execute(sql`alter table requirement_revisions drop constraint test_reject_milestone_creation`)) }
      expect(await database(db => db.query.requirements.findMany({ where: eq(requirements.title, '回滚创建') }))).toEqual([])
      expect(await database(db => db.select().from(requirementStatisticCoverage))).toEqual(coverageBefore)
    })

    it('存量迁移只标缺口；上线后首次观察不补造历史首次，并保留更早的未知区间', async () => {
      const doc = await create(), done = await create('defect')
      await flow(doc.id, ['doing'])
      await flow(done.id, ['doing', 'testing', 'done'])
      await database(async db => {
        for (const id of [doc.id, done.id]) {
          await db.delete(requirementMilestones).where(eq(requirementMilestones.requirementId, id))
          await db.delete(requirementStatisticCoverage).where(eq(requirementStatisticCoverage.requirementId, id))
        }
        const migration = (await readFile('drizzle/0017_requirement_milestones.sql', 'utf8')).split('-- BEGIN legacy coverage')[1]!
        await db.execute(sql.raw(migration))
        await db.execute(sql.raw(migration))
      })
      const getCoverage = (id: string) => database(db => db.query.requirementStatisticCoverage.findMany({ where: eq(requirementStatisticCoverage.requirementId, id) }))
      const before = await getCoverage(doc.id)
      expect(before.every(row => !row.historyComplete && row.completeFrom === null && row.gapReason === 'missing_initial_state')).toBe(true)
      const oldDone = (await getCoverage(done.id))[0]!
      expect(oldDone).toMatchObject({ historyComplete: false, observation: { statusCode: 'done', source: 'migration' } })
      expect(oldDone.completeFrom!.getTime()).toBe(oldDone.observedAt!.getTime() + 1)
      expect(await events(done.id)).toEqual([])
      await flow(doc.id, ['testing'], { assigneeIds: [seedIds.designUserId] })
      const observed = (await getCoverage(doc.id)).find(row => row.kind === 'first_testing')!
      expect(observed).toMatchObject({ historyComplete: false, gapReason: 'missing_initial_state', observation: { source: 'web', assigneeIds: [seedIds.designUserId] } })
      expect(observed.completeFrom!.getTime()).toBe(observed.observedAt!.getTime() + 1)
      expect(await events(doc.id)).toEqual([])
      await flow(doc.id, ['doing', 'testing'], { assigneeIds: [seedIds.currentUserId] })
      expect((await getCoverage(doc.id)).find(row => row.kind === 'first_testing')).toEqual(observed)
      await expect(database(db => db.update(requirementStatisticCoverage).set({ completeFrom: null }).where(and(eq(requirementStatisticCoverage.requirementId, doc.id), eq(requirementStatisticCoverage.kind, 'first_testing'))))).rejects.toMatchObject({ cause: { code: '23514' } })
    })
  })
}
