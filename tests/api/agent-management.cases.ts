import { $fetch } from '@nuxt/test-utils/e2e'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createDatabase } from '../../server/db/client'
import { agentSnapshots, agentSuggestions, auditEvents, requirementAgentLocks, requirements, users } from '../../server/db/schema'
import { replaceDocumentAssignees } from '../../server/services/document-assignees'
import { decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerAgentManagementTests({ apiFetch }: { apiFetch: Api; createRequirement: (title?: string) => Promise<Record<string, any>> }) {
  const createRequirement = (title = '日志验证需求') => apiFetch('/api/requirements', { method: 'POST', body: { title, priority: 'medium' } })
  const credential = () => apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '接管验证' } })
  const agent = (token: string, path: string, body?: unknown, takeover = false) => $fetch<any>(`/api/agent/v1/${path}`, {
    headers: { authorization: `Bearer ${token}`, ...(takeover ? { 'x-rb-mode': 'takeover' } : {}) },
    ...(body === undefined ? {} : { method: 'POST' as const, body }),
  })
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const createInput = () => ({ action: 'create', requestId: nanoid(24), title: '退款规则', changeNote: '建立退款需求和验收标准',
    properties: { priority: 'high' }, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '重复申请只退款一次。' }] }] } })
  async function fixture() {
    const req = await createRequirement('接管草稿')
    const pat = await credential()
    const snapshot = await agent(pat.token, `requirements/${req.id}/snapshot`, {})
    const input = { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '完善退款说明', operations: [] as unknown[] }
    return { req, pat, snapshot, input }
  }
  const expire = (id: string) => database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, id)))

  describe('AI 文档管理与属性日志', () => {
    it('搜索、读取、元数据和版本历史不取得编辑锁，支持需求编号', async () => {
      const req = await createRequirement('查找退款说明')
      const pat = await credential()
      expect(await agent(pat.token, `requirements?q=${encodeURIComponent('退款')}`)).toMatchObject([{ id: req.id }])
      const read = await agent(pat.token, `requirements/${req.key}`)
      expect(read).toMatchObject({ id: req.id, title: '查找退款说明', properties: { priority: 'medium' }, latestRevision: { version: 1 } })
      expect((await agent(pat.token, 'meta')).members).toContainEqual({ id: seedIds.currentUserId, name: 'Mo Bing' })
      const revisions = await agent(pat.token, `requirements/${req.id}/revisions`)
      expect(revisions).toHaveLength(1)
      expect(revisions[0]).not.toHaveProperty('contentJson')
      expect((await agent(pat.token, `revisions/${revisions[0].id}`)).contentJson).toBeDefined()
      expect(await database(db => db.select().from(requirementAgentLocks))).toHaveLength(0)
      await expect($fetch(`/api/agent/v1/requirements/${req.id}`)).rejects.toMatchObject({ statusCode: 401 })
    })

    it('校验不创建文档，默认执行一次创建完整需求与 v1，重试不重复', async () => {
      const pat = await credential(), input = createInput()
      const before = await database(db => db.select().from(requirements))
      expect((await agent(pat.token, 'operations/validate', input)).valid).toBe(true)
      expect(await database(db => db.select().from(agentSuggestions))).toHaveLength(0)
      expect(await database(db => db.select().from(requirements))).toHaveLength(before.length)
      const results = await Promise.all([1, 2].map(() => agent(pat.token, 'operations', input)))
      expect(results[0]).toEqual(results[1])
      expect(results[0]).toMatchObject({ status: 'applied', revision: { version: 1, changeNote: input.changeNote } })
      const read = await agent(pat.token, 'requirements/' + results[0].requirementId)
      expect(read).toMatchObject({ title: input.title, properties: { priority: 'high' } })
      expect(read.contentJson.content[0].content[0].text).toBe('重复申请只退款一次。')
      expect(await apiFetch('/api/requirements/' + results[0].requirementId + '/revisions')).toHaveLength(1)
      const state = await apiFetch('/api/requirements/' + results[0].requirementId + '/collaboration', { method: 'POST', body: {} })
      const doc = new Y.Doc()
      try { Y.applyUpdate(doc, decodeCollaborationState(state.state)); expect(readCollaborationDocument(doc).contentJson).toEqual(read.contentJson) }
      finally { doc.destroy() }
    })

    it('直接新建返回可恢复的执行收据，变更请求内容不可复用 requestId', async () => {
      const pat = await credential(), input = createInput()
      const result = await agent(pat.token, 'operations', input)
      expect(await agent(pat.token, 'operations/' + result.id)).toEqual(result)
      await expect(agent(pat.token, 'operations', { ...input, title: '另一个文档' })).rejects.toMatchObject({ statusCode: 409 })
      expect(result).not.toHaveProperty('reviewUrl')
    })

    it('新建文档拒绝临时图片，校验和执行均不写入', async () => {
      const pat = await credential()
      const input = { ...createInput(), contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: 'blob:http://localhost/temporary', align: 'center' }, content: [{ type: 'imageCaption' }] }] } }
      const before = await database(db => db.select().from(requirements))
      for (const [path, takeover] of [['operations/validate', false], ['operations', false], ['operations', true]] as const) {
        await expect(agent(pat.token, path, input, takeover)).rejects.toMatchObject({ statusCode: 422 })
      }
      expect(await database(db => db.select().from(agentSuggestions))).toHaveLength(0)
      expect(await database(db => db.select().from(requirements))).toHaveLength(before.length)
    })

    it('正文、三项属性及版本保存一起提交，逐字段日志可追溯，重复请求不重复写入', async () => {
      const f = await fixture()
      const before = await apiFetch(`/api/requirements/${f.req.id}/collaboration`, { method: 'POST', body: {} })
      const input = { ...f.input, operations: [{ op: 'set_title', title: '退款与异常处理' }],
        properties: { statusId: seedIds.progressStatusId, assigneeIds: [seedIds.frontendUserId], priority: 'high' },
        saveRevision: { changeNote: '调整退款需求标题，确认异常处理范围' } }
      const result = await agent(f.pat.token, 'operations', input, true)
      expect(result).toMatchObject({ status: 'applied', revision: { version: 2, changeNote: input.saveRevision.changeNote } })
      expect(await agent(f.pat.token, 'operations', input, true)).toEqual(result)
      expect(await apiFetch(`/api/requirements/${f.req.id}/revisions`)).toHaveLength(2)
      const history = await apiFetch(`/api/requirements/${f.req.id}/property-history`)
      expect(history.items).toHaveLength(4)
      expect(new Set(history.items.map((item: any) => item.operationId)).size).toBe(1)
      expect(history.items.every((item: any) => item.source === 'agent_takeover' && item.actor.id === seedIds.currentUserId)).toBe(true)
      expect(history.items.find((item: any) => item.field === 'priority')).toMatchObject({ before: { value: 'medium', label: '中' }, after: { value: 'high', label: '高' } })
      const after = await apiFetch(`/api/requirements/${f.req.id}/collaboration`, { method: 'POST', body: {} })
      const oldDoc = new Y.Doc(), newDoc = new Y.Doc()
      try {
        Y.applyUpdate(oldDoc, decodeCollaborationState(before.state)); Y.applyUpdate(newDoc, decodeCollaborationState(after.state))
        const clocks = Y.decodeStateVector(Y.encodeStateVector(newDoc))
        for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(oldDoc))) expect(clocks.get(client)).toBeGreaterThanOrEqual(clock)
        expect(readCollaborationDocument(newDoc).title).toBe('退款与异常处理')
      } finally { oldDoc.destroy(); newDoc.destroy() }
      await apiFetch(`/api/requirements/${f.req.id}`, { method: 'PATCH', body: input.properties })
      expect((await apiFetch(`/api/requirements/${f.req.id}/property-history`)).items).toHaveLength(4)
    })

    it('只改属性不生成正文版本；网页与 AI 都逐字段记录，失败回滚', async () => {
      const f = await fixture()
      const pending = await agent(f.pat.token, 'operations', { ...f.input, properties: { priority: 'high' } })
      expect((await apiFetch(`/api/requirements/${f.req.id}`)).priority).toBe('high')
      expect(await apiFetch(`/api/requirements/${f.req.id}/revisions`)).toHaveLength(1)
      expect((await apiFetch(`/api/requirements/${f.req.id}/property-history`)).items[0].source).toBe('agent_takeover')
      await apiFetch(`/api/requirements/${f.req.id}`, { method: 'PATCH', body: { priority: 'low', assigneeIds: [seedIds.frontendUserId] } })
      const history = await agent(f.pat.token, `requirements/${f.req.id}/property-history`)
      expect(history.items).toHaveLength(3)
      expect(history.items.filter((item: any) => item.source === 'web')).toHaveLength(2)
      await expect(apiFetch(`/api/requirements/${f.req.id}`, { method: 'PATCH', body: { priority: 'high', assigneeIds: ['missing'] } })).rejects.toMatchObject({ statusCode: 400 })
      expect((await apiFetch(`/api/requirements/${f.req.id}`)).priority).toBe('low')
      expect((await apiFetch(`/api/requirements/${f.req.id}/property-history`)).items).toHaveLength(3)
    })

    it('目标属性变化阻止执行；其他属性保持独立', async () => {
      const f = await fixture(), input = { ...f.input, properties: { priority: 'high' }, saveRevision: { changeNote: '保存退款草稿' } }
      // 模拟快照后来自其他写入源的属性变化，执行必须再次核对目标字段。
      await database(db => db.update(requirements).set({ priority: 'low' }).where(eq(requirements.id, f.req.id)))
      await expect(agent(f.pat.token, 'operations', input)).rejects.toMatchObject({ statusCode: 409 })
      expect(await apiFetch('/api/requirements/' + f.req.id + '/revisions')).toHaveLength(1)
      await database(db => db.transaction(async tx => {
        await tx.update(requirements).set({ priority: 'medium' }).where(eq(requirements.id, f.req.id))
        await replaceDocumentAssignees(tx, f.req.id, [seedIds.frontendUserId])
      }))
      await agent(f.pat.token, 'operations', input)
      expect(await apiFetch('/api/requirements/' + f.req.id)).toMatchObject({ priority: 'high', assigneeIds: [seedIds.frontendUserId] })
    })

    it('负责人关联表变化使旧快照失效，Agent 搜索和快照返回完整名单', async () => {
      const req = await createRequirement()
      const initial = [seedIds.frontendUserId]
      await apiFetch(`/api/requirements/${req.id}`, { method: 'PATCH', body: { assigneeIds: initial } })
      const pat = await credential()
      const listed = await agent(pat.token, `requirements?q=${req.key}`)
      expect(listed[0].assigneeIds).toEqual(initial)
      const snapshot = await agent(pat.token, `requirements/${req.id}/snapshot`, {})
      expect(snapshot.properties.assigneeIds).toEqual(initial)
      const changed = [seedIds.frontendUserId, seedIds.currentUserId].sort()
      await database(db => db.transaction(async tx => {
        await tx.select().from(requirements).where(eq(requirements.id, req.id)).for('update')
        await replaceDocumentAssignees(tx, req.id, changed)
      }))
      await expect(agent(pat.token, 'operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '过期名单', operations: [],
        properties: { assigneeIds: [seedIds.designUserId] } })).rejects.toMatchObject({ statusCode: 409 })
      expect((await apiFetch(`/api/requirements/${req.id}`)).assigneeIds).toEqual(changed)
    })

    it('仅保存版本要求正式版本基线匹配，普通修改不保存', async () => {
      const f = await fixture()
      const saved = await agent(f.pat.token, 'operations', { ...f.input, operations: [{ op: 'set_title', title: '新草稿' }] })
      expect(saved.revision).toBeNull()
      expect(await apiFetch('/api/requirements/' + f.req.id + '/revisions')).toHaveLength(1)
      const snapshot = await agent(f.pat.token, 'requirements/' + f.req.id + '/snapshot', {})
      // 模拟正式版本边界已经前移，旧说明不能写入新范围。
      await database(db => db.update(agentSnapshots).set({ baseRevisionId: null }).where(eq(agentSnapshots.id, snapshot.id)))
      const input = { snapshotId: snapshot.id, requestId: nanoid(24), operations: [], changeNote: '保存', saveRevision: { changeNote: '保存新草稿标题' } }
      await expect(agent(f.pat.token, 'operations', input)).rejects.toMatchObject({ statusCode: 409 })
      await database(db => db.update(agentSnapshots).set({ baseRevisionId: snapshot.baseRevisionId }).where(eq(agentSnapshots.id, snapshot.id)))
      const result = await agent(f.pat.token, 'operations', input)
      expect(result).toMatchObject({ revision: { version: 2, changeNote: input.saveRevision.changeNote } })
      expect(await agent(f.pat.token, 'operations', input)).toEqual(result)
    })

    it('执行前重新校验负责人，失效时正文、版本、属性日志整体不写入', async () => {
      const f = await fixture()
      const input = { ...f.input, operations: [{ op: 'set_title', title: '不应生效' }],
        properties: { assigneeIds: [seedIds.frontendUserId], priority: 'high' }, saveRevision: { changeNote: '不应保存' } }
      expect((await agent(f.pat.token, 'operations/validate', input)).valid).toBe(true)
      await database(db => db.update(users).set({ banned: true }).where(eq(users.id, seedIds.frontendUserId)))
      await expect(agent(f.pat.token, 'operations', input)).rejects.toMatchObject({ statusCode: 400 })
      expect((await apiFetch(`/api/requirements/${f.req.id}`)).assigneeIds).toEqual([])
      expect((await agent(f.pat.token, 'requirements/' + f.req.id)).title).toBe(f.snapshot.title)
      expect((await apiFetch('/api/requirements/' + f.req.id + '/property-history')).items).toHaveLength(0)
      expect(await apiFetch('/api/requirements/' + f.req.id + '/revisions')).toHaveLength(1)
    })

    it('属性日志按时间与 ID 完整分页，其他文档的游标不可使用', async () => {
      const req = await createRequirement(), other = await createRequirement()
      const timestamp = new Date()
      await database(db => db.insert(auditEvents).values(Array.from({ length: 55 }, (_, index) => ({ id: `audit_page_${index.toString().padStart(3, '0')}`,
        projectId: seedIds.projectId, actorId: seedIds.currentUserId, targetId: req.id, action: 'requirement.property.change', createdAt: timestamp,
        detail: { field: 'priority', label: '优先级', before: { value: 'medium', label: '中' }, after: { value: 'high', label: '高' }, source: 'web', operationId: `operation_${index}` } }))))
      const first = await apiFetch(`/api/requirements/${req.id}/property-history`)
      const second = await apiFetch(`/api/requirements/${req.id}/property-history?cursor=${first.nextCursor}`)
      expect(first.items).toHaveLength(50); expect(second.items).toHaveLength(5); expect(second.nextCursor).toBe(null)
      expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(55)
      await expect(apiFetch(`/api/requirements/${other.id}/property-history?cursor=${first.nextCursor}`)).rejects.toMatchObject({ statusCode: 400 })
      expect(await database(db => db.select().from(auditEvents).where(and(eq(auditEvents.targetId, req.id), eq(auditEvents.action, 'requirement.property.change'))))).toHaveLength(55)
    })
  })
}
