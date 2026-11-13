import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import * as Y from 'yjs'
import { createDatabase } from '../../server/db/client'
import { assets, auditEvents, documentTemplates, requirementAssignees, requirementCollaborationDocuments, requirementMilestones, requirements, requirementStatuses, users } from '../../server/db/schema'
import { garbageCollectAssets } from '../../server/services/asset-gc'
import { createAssetStorage } from '../../server/services/asset-storage'
import { builtInTemplates } from '../../shared/documents/templates'
import { DOCUMENT_TYPES, initialDocumentState, type DocumentType } from '../../shared/documents/workflow'
import { createCollaborationDocument, decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import { createEmptyDocument, extractPlainText } from '../../shared/editor/document'
import { TEST_ADMIN_PASSWORD, TEST_DATABASE_URL, seedIds } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerDocumentTests({ apiFetch, readSessionCookie, uploadsDir }: { apiFetch: Api; readSessionCookie: (response: Response) => string; uploadsDir: string }) {
  const create = (documentType: DocumentType, extra = {}) => apiFetch('/api/requirements', { method: 'POST', body: { title: '类型与模板验证', documentType, templateId: `builtin_${documentType}`, ...extra } })
  const patch = (id: string, body: unknown) => apiFetch(`/api/requirements/${id}`, { method: 'PATCH', body })
  const templateInput = () => ({ name: '团队模板', documentType: 'requirement', description: '团队正文结构', contentJson: builtInTemplates()[0]!.contentJson })
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) { const { db, client } = createDatabase(TEST_DATABASE_URL); try { return await work(db) } finally { await client.end() } }
  async function adminApi() {
    const response = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }) })
    expect(response.status).toBe(200)
    const cookie = readSessionCookie(response)
    return <T = any>(path: string, options: Record<string, any> = {}) => $fetch<T>(path, { ...options, headers: { cookie } })
  }
  describe('文档类型、模板和状态流程', () => {
    it('提示块模板接受四种语气，拒绝未知语气且不写入', async () => {
      const contentJson = { type: 'doc', content: ['note', 'tip', 'warning', 'danger'].map(tone => ({ type: 'callout', attrs: { tone }, content: [{ type: 'text', text: tone }] })) }
      const saved = await apiFetch('/api/document-templates', { method: 'POST', body: { ...templateInput(), contentJson } })
      expect(saved.contentJson.content.slice(0, 4).map((node: any) => node.attrs.tone)).toEqual(['note', 'tip', 'warning', 'danger'])
      const invalid = { type: 'doc', content: [{ type: 'callout', attrs: { tone: 'success' } }] }
      await expect(apiFetch(`/api/document-templates/${saved.id}`, { method: 'PUT', body: { ...templateInput(), version: saved.version, contentJson: invalid } })).rejects.toMatchObject({ statusCode: 400 })
      const rows = await database(db => db.select().from(documentTemplates).where(eq(documentTemplates.id, saved.id)))
      expect(rows[0]!.contentJson).toEqual(saved.contentJson)
    })
    it('缺少回执迁移时明确报错且不泄漏 SQL，补齐后原提交可创建并安全重试', async () => {
      const headers = { 'Idempotency-Key': 'document_migration_recovery_001' }
      const body = { title: '迁移后恢复创建', templateId: null }
      // 只在隔离 API 测试库中暂时改名，复现旧库缺表；finally 始终恢复。
      await database(db => db.execute(sql`alter table document_write_receipts rename to document_write_receipts_pending_migration`))
      try {
        const failure = await apiFetch('/api/requirements', { method: 'POST', body, headers }).catch(error => error)
        expect(failure).toMatchObject({ statusCode: 503, data: { message: '服务升级尚未完成，请联系管理员处理后重试。', data: { code: 'DATABASE_MIGRATION_REQUIRED' } } })
        expect(JSON.stringify(failure.data)).not.toMatch(/Failed query|select |document_write_receipts|params:/)
      } finally {
        await database(db => db.execute(sql`alter table document_write_receipts_pending_migration rename to document_write_receipts`))
      }
      const created = await apiFetch('/api/requirements', { method: 'POST', body, headers })
      expect((await apiFetch('/api/requirements', { method: 'POST', body, headers })).id).toBe(created.id)
      expect(await apiFetch(`/api/requirements/${created.id}/revisions`)).toHaveLength(1)
    })

    it('网页创建和模板保存按账号核验幂等标识，并发及丢失响应重试不重复写入', async () => {
      const headers = { 'Idempotency-Key': 'document_creation_retry_001' }
      const body = { title: '创建响应丢失', documentType: 'requirement', templateId: null }
      const [first, duplicate] = await Promise.all([1, 2].map(() => apiFetch('/api/requirements', { method: 'POST', body, headers })))
      expect(duplicate.id).toBe(first.id)
      expect(await apiFetch(`/api/requirements/${first.id}/revisions`)).toHaveLength(1)
      await expect(apiFetch('/api/requirements', { method: 'POST', body: { ...body, title: '不同输入' }, headers })).rejects.toMatchObject({ statusCode: 409 })
      const admin = await adminApi()
      expect((await admin('/api/requirements', { method: 'POST', body, headers })).id).not.toBe(first.id)
      const templateHeaders = { 'Idempotency-Key': 'template_creation_retry_001' }
      const input = templateInput()
      const [template, retry] = await Promise.all([1, 2].map(() => apiFetch('/api/document-templates', { method: 'POST', body: input, headers: templateHeaders })))
      expect(retry.id).toBe(template.id)
      const update = { ...input, name: '更新模板', version: template.version }
      const updateHeaders = { 'Idempotency-Key': 'template_update_retry_001' }
      const saved = await apiFetch(`/api/document-templates/${template.id}`, { method: 'PUT', body: update, headers: updateHeaders })
      expect((await apiFetch(`/api/document-templates/${template.id}`, { method: 'PUT', body: update, headers: updateHeaders })).version).toBe(saved.version)
      await expect(apiFetch('/api/document-templates', { method: 'POST', body: input, headers })).rejects.toMatchObject({ statusCode: 409 })
    })

    it('失败创建整体回滚，不消耗幂等标识；非法标识不写入', async () => {
      const headers = { 'Idempotency-Key': 'document_failed_creation_001' }
      await expect(create('requirement', { templateId: 'missing' })).rejects.toMatchObject({ statusCode: 404 })
      await expect(apiFetch('/api/requirements', { method: 'POST', body: { title: '失败请求', templateId: 'missing' }, headers })).rejects.toMatchObject({ statusCode: 404 })
      const result = await apiFetch('/api/requirements', { method: 'POST', body: { title: '修正请求', templateId: null }, headers })
      expect(result.title).toBe('修正请求')
      await expect(apiFetch('/api/requirements', { method: 'POST', body: { title: '无效标识' }, headers: { 'Idempotency-Key': 'bad' } })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('升级保留旧系统已同步未存版的标题，保护独立改名、空白输入和原 Yjs 历史', async () => {
      const cases = [
        { draft: ' 尚未存版的新标题 ', metadata: null, expected: '尚未存版的新标题' },
        { draft: '旧共同草稿标题', metadata: '已经独立保存的标题', expected: '已经独立保存的标题' },
        { draft: ' \t\n ', metadata: null, expected: '类型与模板验证' },
      ]
      const fixtures = []
      for (const item of cases) {
        const created = await create('requirement')
        const detail = await apiFetch(`/api/requirements/${created.id}`)
        const doc = createCollaborationDocument({ title: item.draft, contentJson: detail.currentRevision.contentJson })
        try {
          const state = Y.encodeStateAsUpdate(doc)
          await database(async db => {
            await db.insert(requirementCollaborationDocuments).values({ requirementId: created.id, title: item.draft,
              contentJson: detail.currentRevision.contentJson, state })
            if (item.metadata) await db.update(requirements).set({ title: item.metadata }).where(eq(requirements.id, created.id))
          })
          fixtures.push({ ...item, created, detail, state })
        } finally { doc.destroy() }
      }
      const migration = await readFile('drizzle/0016_independent_document_title.sql', 'utf8')
      await database(async db => { await db.execute(sql.raw(migration)); await db.execute(sql.raw(migration)) })
      for (const item of fixtures) {
        expect(await apiFetch(`/api/requirements/${item.created.id}`)).toMatchObject({ title: item.expected,
          currentRevision: { id: item.detail.currentRevision.id, title: item.created.title } })
        const current = await database(db => db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, item.created.id) }))
        expect(current!.state).toEqual(item.state)
        expect(current!.contentJson).toEqual(item.detail.currentRevision.contentJson)
      }
    })

    it('标题独立保存并记录属性日志，不改历史版本或正文；旧保存请求不能改回标题', async () => {
      const created = await create('requirement')
      const path = `/api/requirements/${created.id}`
      const before = await apiFetch(path)
      const loaded = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
      const old = new Y.Doc()
      try {
        Y.applyUpdate(old, decodeCollaborationState(loaded.state))
        const clocks = Y.decodeStateVector(Y.encodeStateVector(old))
        expect(await patch(created.id, { title: '  独立保存的新标题  ', mutationId: 'metadata_title_test' })).toMatchObject({ title: '独立保存的新标题' })
        expect(await apiFetch(path)).toMatchObject({ title: '独立保存的新标题', currentRevision: { id: before.currentRevision.id, title: before.title } })
        expect(await apiFetch(`${path}/revisions`)).toHaveLength(1)
        expect((await apiFetch('/api/requirements')).items.find((item: any) => item.id === created.id).title).toBe('独立保存的新标题')
        const current = new Y.Doc()
        try {
          const saved = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
          Y.applyUpdate(current, decodeCollaborationState(saved.state))
          expect(readCollaborationDocument(current)).toEqual({ title: '独立保存的新标题', contentJson: before.currentRevision.contentJson })
          const nextClocks = Y.decodeStateVector(Y.encodeStateVector(current))
          for (const [client, clock] of clocks) expect(nextClocks.get(client)).toBeGreaterThanOrEqual(clock)
          expect(saved.editEpoch).toBe(loaded.editEpoch)
        } finally { current.destroy() }
        await patch(created.id, { title: '独立保存的新标题' })
        const history = await apiFetch(`${path}/property-history`)
        expect(history.items).toHaveLength(1)
        expect(history.items[0]).toMatchObject({ field: 'title', before: { value: before.title }, after: { value: '独立保存的新标题' }, source: 'web' })
        const body = { title: before.title, contentJson: before.currentRevision.contentJson, clientSaveId: 'title_snapshot_once',
          collaborationUpdate: Buffer.from(Y.encodeStateAsUpdate(old)).toString('base64'), changeNote: '保存正文' }
        const revision = await apiFetch(`${path}/revisions`, { method: 'POST', body })
        expect(revision.title).toBe('独立保存的新标题')
        await patch(created.id, { title: '再次改名' })
        expect((await apiFetch(`${path}/revisions`, { method: 'POST', body })).id).toBe(revision.id)
        expect((await apiFetch(path)).title).toBe('再次改名')
        expect((await apiFetch(`/api/revisions/${revision.id}`)).title).toBe('独立保存的新标题')
      } finally { old.destroy() }
    })

    it('标题校验或混合属性修改失败时，名称、共同草稿、日志和版本全部保持原状', async () => {
      const created = await create('todo')
      const path = `/api/requirements/${created.id}`
      const before = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
      for (const body of [{ title: ' ' }, { title: '长'.repeat(241) }, { title: '不能部分成功', assigneeIds: ['missing_user'] }]) {
        await expect(patch(created.id, body)).rejects.toMatchObject({ statusCode: 400 })
      }
      expect((await apiFetch(path)).title).toBe(created.title)
      expect((await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })).state).toBe(before.state)
      expect((await apiFetch(`${path}/property-history`)).items).toEqual([])
      expect(await apiFetch(`${path}/revisions`)).toHaveLength(1)
    })

    it('四种类型从模板以初始状态创建完整 v1，协作正文一致且每份正文有独立块 ID', async () => {
      const catalog = await apiFetch('/api/document-templates')
      expect(catalog).toHaveLength(4)
      await expect($fetch('/api/document-templates')).rejects.toMatchObject({ statusCode: 401 })
      for (const type of DOCUMENT_TYPES) {
        const first = await create(type), second = await create(type)
        expect(first).toMatchObject({ documentType: type, status: { code: initialDocumentState(type) }, assigneeIds: [] })
        const detail = await apiFetch(`/api/requirements/${first.id}`)
        const other = await apiFetch(`/api/requirements/${second.id}`)
        const template = catalog.find((item: any) => item.documentType === type)
        expect(detail.currentRevision.contentText).toBe(extractPlainText(template.contentJson))
        expect(detail.currentRevision.version).toBe(1)
        const ids = detail.currentRevision.contentJson.content.map((node: any) => node.attrs.diffId)
        expect(new Set(ids).size).toBe(ids.length)
        expect(other.currentRevision.contentJson.content.some((node: any) => ids.includes(node.attrs.diffId))).toBe(false)
        const state = await apiFetch(`/api/requirements/${first.id}/collaboration`, { method: 'POST', body: {} })
        const doc = new Y.Doc()
        try { Y.applyUpdate(doc, decodeCollaborationState(state.state)); expect(readCollaborationDocument(doc).contentJson).toEqual(detail.currentRevision.contentJson) } finally { doc.destroy() }
      }
      await expect(create('defect', { templateId: 'builtin_requirement' })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('四种类型均可显式选择空白模板，省略模板仍兼容原有创建请求', async () => {
      const ids = new Set<string>()
      for (const type of DOCUMENT_TYPES) {
        const created = await create(type, { templateId: null })
        const detail = await apiFetch(`/api/requirements/${created.id}`)
        expect(detail).toMatchObject({ documentType: type, status: { code: initialDocumentState(type) }, currentRevision: { version: 1, contentText: '' } })
        expect(detail.currentRevision.contentJson.content).toHaveLength(1)
        const paragraph = detail.currentRevision.contentJson.content[0]
        expect(paragraph.type).toBe('paragraph')
        expect(paragraph.attrs.diffId).toEqual(expect.any(String))
        expect(ids.has(paragraph.attrs.diffId)).toBe(false)
        ids.add(paragraph.attrs.diffId)
        const state = await apiFetch(`/api/requirements/${created.id}/collaboration`, { method: 'POST', body: {} })
        const doc = new Y.Doc()
        try { Y.applyUpdate(doc, decodeCollaborationState(state.state)); expect(readCollaborationDocument(doc).contentJson).toEqual(detail.currentRevision.contentJson) } finally { doc.destroy() }
      }
      const legacy = await apiFetch('/api/requirements', { method: 'POST', body: { title: '兼容省略模板的请求' } })
      const detail = await apiFetch(`/api/requirements/${legacy.id}`)
      expect(detail.currentRevision.contentText).toBe(extractPlainText(builtInTemplates()[0]!.contentJson))
      await expect(create('requirement', { templateId: '' })).rejects.toMatchObject({ statusCode: 400 })
      await expect(create('requirement', { templateId: 'missing_template' })).rejects.toMatchObject({ statusCode: 404 })
    })

    it('同类型内任意切换状态，跨类型状态和非初始创建返回 409；expectedStatusId 不一致不覆盖', async () => {
      const meta = await apiFetch('/api/meta')
      expect(meta.statuses.map((item: any) => item.code)).toEqual(['queued', 'doing', 'testing', 'done', 'closed', 'draft', 'published', 'archived'])
      const state = (code: string) => meta.statuses.find((item: any) => item.code === code).id
      const move = (id: string, code: string, body: Record<string, unknown> = {}) => patch(id, { statusId: state(code), ...body })
      for (const type of ['requirement', 'defect', 'todo'] as const) {
        const doc = await create(type)
        await expect(move(doc.id, 'published')).rejects.toMatchObject({ statusCode: 409, data: { data: { code: 'INVALID_TRANSITION' } } })
        for (const code of ['done', 'queued', 'testing', 'doing', 'closed', 'testing', 'done']) await move(doc.id, code)
        expect((await apiFetch(`/api/requirements/${doc.id}`)).status.code).toBe('done')
      }
      const instruction = await create('instruction')
      await expect(move(instruction.id, 'doing')).rejects.toMatchObject({ statusCode: 409 })
      for (const code of ['archived', 'draft', 'published']) await move(instruction.id, code)
      await expect(create('requirement', { statusId: state('done') })).rejects.toMatchObject({ statusCode: 409 })
      await expect(create('instruction', { statusId: state('queued') })).rejects.toMatchObject({ statusCode: 409 })

      const doc = await create('requirement')
      await move(doc.id, 'doing', { expectedStatusId: state('queued') })
      const stale = await move(doc.id, 'testing', { expectedStatusId: state('queued') }).catch(error => error)
      expect(stale).toMatchObject({ statusCode: 409, data: { data: { code: 'STATUS_CONFLICT', currentStatus: { id: state('doing'), name: '进行中' } } } })
      const history = await apiFetch(`/api/requirements/${doc.id}/property-history`)
      expect(history.items.map((item: any) => [item.before.label, item.after.label, item.source])).toEqual([['待处理', '进行中', 'web']])
      expect((await apiFetch(`/api/requirements/${doc.id}`)).status.code).toBe('doing')
    })

    it('状态精简迁移按类型映射旧状态，写 migration 日志并停用旧状态，不改更新时间或里程碑', async () => {
      const [, ...statements] = (await readFile('drizzle/20261108045749_simplify_document_states.sql', 'utf8')).split('--> statement-breakpoint')
      const legacy = { review: '待评审', ready: '待开发', development: '开发中', acceptance: '待验收', release: '待上线',
        confirmation: '待确认', repair_ready: '待修复', repairing: '修复中', verification: '待验证' }
      const cases: [DocumentType, string, string][] = [['requirement', 'review', 'queued'], ['requirement', 'development', 'doing'], ['requirement', 'release', 'testing'],
        ['defect', 'confirmation', 'queued'], ['defect', 'repairing', 'doing'], ['defect', 'verification', 'testing'], ['todo', 'draft', 'queued'],
        ['requirement', 'done', 'done'], ['instruction', 'closed', 'archived'], ['instruction', 'published', 'published']]
      const docs = await Promise.all(cases.map(([type]) => create(type)))
      const rollback = new Error('rollback')
      await expect(database(db => db.transaction(async tx => {
        await tx.insert(requirementStatuses).values(Object.entries(legacy).map(([code, name], index) => ({
          id: `legacy_${code}`, projectId: seedIds.projectId, code, name, color: '#888888', sortOrder: 100 + index })))
        const ids = Object.fromEntries((await tx.select().from(requirementStatuses).where(eq(requirementStatuses.projectId, seedIds.projectId))).map(row => [row.code, row.id]))
        for (const [index, [, from]] of cases.entries()) await tx.update(requirements).set({ statusId: ids[from]! }).where(eq(requirements.id, docs[index].id))
        const before = await tx.select({ id: requirements.id, updatedAt: requirements.updatedAt }).from(requirements).orderBy(requirements.id)
        const milestones = await tx.select().from(requirementMilestones)
        for (const statement of statements) await tx.execute(sql.raw(statement))
        for (const [index, [, from, to]] of cases.entries()) {
          const row = await tx.query.requirements.findFirst({ where: eq(requirements.id, docs[index].id), with: { status: true } })
          expect([from, row!.status.code]).toEqual([from, to])
          const logs = await tx.select().from(auditEvents).where(and(eq(auditEvents.targetId, docs[index].id), eq(auditEvents.action, 'requirement.property.change')))
          expect(logs.map(log => [log.detail.source, log.detail.after.value])).toEqual(from === to ? [] : [['migration', ids[to]]])
        }
        const operations = await tx.select().from(auditEvents).where(sql`${auditEvents.detail}->>'source' = 'migration'`)
        expect(new Set(operations.map(log => log.detail.operationId)).size).toBe(1)
        expect(await tx.select({ id: requirements.id, updatedAt: requirements.updatedAt }).from(requirements).orderBy(requirements.id)).toEqual(before)
        expect(await tx.select().from(requirementMilestones)).toEqual(milestones)
        const catalog = await tx.select().from(requirementStatuses).where(eq(requirementStatuses.projectId, seedIds.projectId)).orderBy(requirementStatuses.sortOrder)
        expect(catalog.filter(row => row.active).map(row => row.code)).toEqual(['queued', 'doing', 'testing', 'done', 'closed', 'draft', 'published', 'archived'])
        expect(catalog.filter(row => !row.active).map(row => row.code).sort()).toEqual(Object.keys(legacy).sort())
        expect(new Set(catalog.map(row => row.name)).size).toBe(catalog.length)
        throw rollback
      }))).rejects.toBe(rollback)
    })

    it('四类文档均可创建、替换和清空多位负责人，响应来自关联表且不返回旧字段', async () => {
      const ids = [seedIds.currentUserId, seedIds.frontendUserId]
      for (const type of DOCUMENT_TYPES) {
        const doc = await create(type, { assigneeIds: ids })
        expect(doc.assigneeIds).toEqual([...ids].sort())
        expect(doc.assignees.map((person: any) => person.id)).toEqual([...ids].sort())
        expect(doc).not.toHaveProperty('assigneeId')
        expect(doc).not.toHaveProperty('assignee')
        const rows = await database(db => db.select().from(requirementAssignees).where(eq(requirementAssignees.requirementId, doc.id)))
        expect(rows.map(row => row.userId).sort()).toEqual([...ids].sort())
        await patch(doc.id, { assigneeIds: [...ids].reverse() })
        expect((await apiFetch(`/api/requirements/${doc.id}/property-history`)).items).toHaveLength(0)
        const replacement = [seedIds.designUserId, seedIds.frontendUserId].sort()
        expect((await patch(doc.id, { assigneeIds: replacement })).assigneeIds).toEqual(replacement)
        expect((await patch(doc.id, { assigneeIds: [] })).assignees).toEqual([])
        expect((await apiFetch(`/api/requirements/${doc.id}`)).assigneeIds).toEqual([])
        expect(await database(db => db.select().from(requirementAssignees).where(eq(requirementAssignees.requirementId, doc.id)))).toEqual([])
      }
    })

    it('负责人关联表拒绝不存在的文档、用户和重复关系，删除文档级联清理分配', async () => {
      const doc = await create('requirement', { assigneeIds: [seedIds.frontendUserId] })
      await database(async db => {
        await expect(db.insert(requirementAssignees).values({ requirementId: doc.id, userId: 'missing_user' })).rejects.toThrow()
        await expect(db.insert(requirementAssignees).values({ requirementId: 'missing_document', userId: seedIds.frontendUserId })).rejects.toThrow()
        await expect(db.insert(requirementAssignees).values({ requirementId: doc.id, userId: seedIds.frontendUserId })).rejects.toThrow()
        await expect(db.delete(users).where(eq(users.id, seedIds.frontendUserId))).rejects.toThrow()
        await db.delete(requirements).where(eq(requirements.id, doc.id))
        expect(await db.select().from(requirementAssignees).where(eq(requirementAssignees.requirementId, doc.id))).toEqual([])
      })
    })

    it('后续日志写入失败时分配关系、文档属性和已写日志一起回滚', async () => {
      const initial = [seedIds.currentUserId, seedIds.frontendUserId].sort()
      const doc = await create('todo', { assigneeIds: initial })
      await database(async db => {
        await db.execute(sql`alter table audit_events add constraint test_reject_priority_log
          check (action <> 'requirement.property.change' or detail->>'field' <> 'priority')`)
        try {
          await expect(patch(doc.id, { assigneeIds: [seedIds.designUserId], priority: 'high' })).rejects.toMatchObject({ statusCode: 500 })
        } finally {
          await db.execute(sql`alter table audit_events drop constraint test_reject_priority_log`)
        }
      })
      expect(await apiFetch(`/api/requirements/${doc.id}`)).toMatchObject({ assigneeIds: initial, priority: 'medium' })
      expect((await apiFetch(`/api/requirements/${doc.id}/property-history`)).items).toEqual([])
    })

    it('按完整名单记日志，拒绝重复、无效成员和旧单人字段，失败不改变现有名单', async () => {
      const ids = [seedIds.currentUserId, seedIds.frontendUserId]
      const req = await create('requirement', { assigneeIds: ids })
      expect(req.assigneeIds).toEqual([...ids].sort())
      const listed = (await apiFetch('/api/requirements')).items.find((item: any) => item.id === req.id)
      expect(listed.assignees.map((person: any) => person.id)).toEqual([...ids].sort())
      await expect(create('requirement', { assigneeId: seedIds.frontendUserId })).rejects.toMatchObject({ statusCode: 400 })
      await expect(patch(req.id, { assigneeId: null })).rejects.toMatchObject({ statusCode: 400 })
      await expect(patch(req.id, { assigneeIds: [seedIds.frontendUserId, seedIds.frontendUserId] })).rejects.toMatchObject({ statusCode: 400 })
      await expect(patch(req.id, { assigneeIds: [seedIds.outsiderUserId] })).rejects.toMatchObject({ statusCode: 400 })
      await database(db => db.update(users).set({ banned: true }).where(eq(users.id, seedIds.designUserId)))
      await expect(patch(req.id, { assigneeIds: [seedIds.designUserId] })).rejects.toMatchObject({ statusCode: 400 })
      expect((await apiFetch(`/api/requirements/${req.id}`)).assigneeIds).toEqual([...ids].sort())
      await patch(req.id, { assigneeIds: [seedIds.currentUserId] })
      const history = await apiFetch(`/api/requirements/${req.id}/property-history`)
      expect(history.items[0]).toMatchObject({ field: 'assigneeIds', before: { value: [...ids].sort() }, after: { value: [seedIds.currentUserId] } })
      await patch(req.id, { assigneeIds: [] })
      expect((await apiFetch(`/api/requirements/${req.id}`)).assigneeIds).toEqual([])
    })

    it('模板可创建、复制和修改；内置模板只读、共享权限和并发版本受保护，修改不影响已有文档', async () => {
      const admin = await adminApi(), input = templateInput()
      const own = await apiFetch('/api/document-templates', { method: 'POST', body: input })
      const req = await create('requirement', { templateId: own.id })
      const before = await apiFetch(`/api/requirements/${req.id}`)
      const changed = { ...input, contentJson: createEmptyDocument(), version: own.version }
      await apiFetch(`/api/document-templates/${own.id}`, { method: 'PUT', body: changed })
      await expect(apiFetch(`/api/document-templates/${own.id}`, { method: 'PUT', body: changed })).rejects.toMatchObject({ statusCode: 409 })
      expect((await apiFetch(`/api/requirements/${req.id}`)).currentRevision).toEqual(before.currentRevision)
      const next = await create('requirement', { templateId: own.id })
      expect((await apiFetch(`/api/requirements/${next.id}`)).currentRevision.contentText).toBe('')
      const shared = await admin('/api/document-templates', { method: 'POST', body: input })
      expect((await apiFetch('/api/document-templates')).find((item: any) => item.id === shared.id).canEdit).toBe(false)
      await expect(apiFetch(`/api/document-templates/${shared.id}`, { method: 'PUT', body: { ...input, version: 1 } })).rejects.toMatchObject({ statusCode: 403 })
      await admin(`/api/document-templates/${own.id}`, { method: 'PUT', body: { ...input, version: 2 } })
      await expect(admin('/api/document-templates/builtin_requirement', { method: 'PUT', body: { ...input, version: 1 } })).rejects.toMatchObject({ statusCode: 404 })
      await database(db => db.update(documentTemplates).set({ projectId: seedIds.otherProjectId }).where(eq(documentTemplates.id, shared.id)))
      await expect(create('requirement', { templateId: shared.id })).rejects.toMatchObject({ statusCode: 404 })
    })

    it('模板图片可共享和复制到文档，GC 同时保护模板和历史正文', async () => {
      const form = new FormData(); form.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'template.png')
      const asset = await apiFetch('/api/assets/upload', { method: 'POST', body: form })
      const input = { ...templateInput(), contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: asset.url, align: 'center' }, content: [{ type: 'imageCaption' }] }] } }
      const template = await apiFetch('/api/document-templates', { method: 'POST', body: input })
      const admin = await adminApi()
      await expect(admin(asset.url)).resolves.toBeDefined()
      const storage = createAssetStorage({ driver: 'local', uploadDir: uploadsDir })
      try {
        await database(async db => {
          await db.update(assets).set({ createdAt: new Date(0) }).where(eq(assets.id, asset.id))
          expect((await garbageCollectAssets(db, { storage, dryRun: true })).candidates).not.toContain(asset.id)
        })
        await create('requirement', { templateId: template.id })
        await apiFetch(`/api/document-templates/${template.id}`, { method: 'PUT', body: { ...input, contentJson: createEmptyDocument(), version: 1 } })
        await database(async db => { expect((await garbageCollectAssets(db, { storage, dryRun: true, now: new Date(Date.now() + 8 * 86400_000) })).candidates).not.toContain(asset.id) })
        const unused = await apiFetch('/api/assets/upload', { method: 'POST', body: form })
        const unusedInput = { ...input, contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: unused.url, align: 'center' }, content: [{ type: 'imageCaption' }] }] } }
        const unusedTemplate = await apiFetch('/api/document-templates', { method: 'POST', body: unusedInput })
        await database(db => db.update(assets).set({ createdAt: new Date(0) }).where(eq(assets.id, unused.id)))
        await apiFetch(`/api/document-templates/${unusedTemplate.id}`, { method: 'PUT', body: { ...unusedInput, contentJson: createEmptyDocument(), version: 1 } })
        await database(async db => {
          expect((await garbageCollectAssets(db, { storage, dryRun: true })).candidates).not.toContain(unused.id)
          expect((await garbageCollectAssets(db, { storage, dryRun: true, now: new Date(Date.now() + 8 * 86400_000) })).candidates).toContain(unused.id)
        })
      } finally { storage.close() }
    })

    it('Agent 同样支持类型、多人分配，并拒绝其他类型的状态', async () => {
      const credential = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '流程验证' } })
      const agent = (path: string, body?: unknown) => $fetch<any>(`/api/agent/v1/${path}`, { headers: { authorization: `Bearer ${credential.token}` }, ...(body ? { method: 'POST' as const, body } : {}) })
      const result = await agent('operations', { action: 'create', documentType: 'defect', requestId: 'create_document_type_bug', title: '缺陷', changeNote: '创建缺陷', contentJson: createEmptyDocument(), properties: { assigneeIds: [seedIds.frontendUserId] } })
      expect((await apiFetch(`/api/requirements/${result.requirementId}`)).documentType).toBe('defect')
      const snapshot = await agent(`requirements/${result.requirementId}/snapshot`, {})
      expect(snapshot.documentType).toBe('defect')
      const meta = await agent('meta')
      expect(meta.workflows.defect).toEqual({ initial: 'queued', states: ['queued', 'doing', 'testing', 'done', 'closed'], transitions: 'any' })
      expect(meta.statuses.some((item: any) => item.code === 'review')).toBe(false)
      await expect(agent('operations/validate', { snapshotId: snapshot.id, requestId: 'invalid_document_state', changeNote: '其他类型状态', operations: [], properties: { statusId: meta.statuses.find((item: any) => item.code === 'published').id } })).rejects.toMatchObject({ statusCode: 409 })
      await agent('operations/validate', { snapshotId: snapshot.id, requestId: 'direct_done_defect', changeNote: '直接完成', operations: [], properties: { statusId: meta.statuses.find((item: any) => item.code === 'done').id } })
      await agent('operations', { snapshotId: snapshot.id, requestId: 'multiple_document_owners', changeNote: '多人缺陷', operations: [], properties: { assigneeIds: [seedIds.currentUserId, seedIds.frontendUserId] } })
      expect((await agent(`requirements/${result.requirementId}`)).properties.assigneeIds).toEqual([seedIds.currentUserId, seedIds.frontendUserId].sort())
      const multiple = await create('requirement', { assigneeIds: [seedIds.currentUserId, seedIds.frontendUserId] })
      const multiSnapshot = await agent(`requirements/${multiple.id}/snapshot`, {})
      expect(multiSnapshot.documentType).toBe('requirement')
      await expect(agent('operations/validate', { snapshotId: multiSnapshot.id, requestId: 'reorder_only_assignees', changeNote: '仅名单顺序变化', operations: [], properties: { assigneeIds: [...multiple.assigneeIds].reverse() } })).rejects.toMatchObject({ statusCode: 422 })
      await expect(agent('operations', { snapshotId: multiSnapshot.id, requestId: 'legacy_replace_assignees', changeNote: '旧字段', operations: [], properties: { assigneeId: multiple.assigneeIds[0] } })).rejects.toMatchObject({ statusCode: 422 })
      await agent('operations', { snapshotId: multiSnapshot.id, requestId: 'replace_assignees', changeNote: '只保留一位负责人', operations: [], properties: { assigneeIds: [multiple.assigneeIds[0]] } })
      expect((await apiFetch(`/api/requirements/${multiple.id}`)).assigneeIds).toEqual([multiple.assigneeIds[0]])
    })
  })
}
