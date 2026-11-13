import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import { createDatabase } from '../../server/db/client'
import { agentSnapshots, agentSuggestions, agentTokens, assets, auditEvents, projectMembers, requirementAgentLocks, requirementCollaborationDocuments, requirementEditEvents, users } from '../../server/db/schema'
import { garbageCollectAssets } from '../../server/services/asset-gc'
import { expireAnnotationCompletions } from '../../server/services/annotation-completions'
import { ANNOTATION_COMPLETION_RETENTION_MS } from '../../shared/agent/annotation-completion'
import { decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import type { AgentSnapshotDto } from '../../shared/agent/suggestions'
import { seedIds, TEST_ADMIN_PASSWORD, TEST_DATABASE_URL, TEST_USER_PASSWORD } from '../setup/db'
import { skillFiles } from '../../skills/requirement-board/scripts/files.mjs'

interface Harness {
  apiFetch: <T = unknown>(url: string, options?: Record<string, any>) => Promise<T>
  createRequirement: (title?: string) => Promise<Record<string, any>>
  readSessionCookie: (response: Response) => string
}

export function registerAgentSuggestionTests({ apiFetch, createRequirement, readSessionCookie }: Harness) {
  async function login(username: string, password: string) {
    const response = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    expect(response.status).toBe(200)
    const cookie = readSessionCookie(response)
    return <T = any>(url: string, options: Record<string, any> = {}) => $fetch<T>(url, { ...options, headers: { ...options.headers, cookie } })
  }
  const credential = () => apiFetch<{ id: string; token: string }>('/api/account/agent-tokens', { method: 'POST', body: { name: '测试 Agent' } })
  const agent = <T = any>(token: string, path: string, body?: unknown) => $fetch<T>(`/api/agent/v1/${path}`, {
    headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { method: 'POST' as const, body }),
  })
  async function fixture() {
    const req = await createRequirement('AI 测试需求')
    const pat = await credential()
    const snapshot = await agent<AgentSnapshotDto>(pat.token, `requirements/${req.id}/snapshot`, {})
    const proposal = { snapshotId: snapshot.id, requestId: `request_${nanoid(24)}`, changeNote: '补充验收标准',
      operations: [{ op: 'set_title', title: '补充后的需求标题' }] }
    return { req, pat, snapshot, proposal }
  }
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  async function editBody(req: string, epoch: number, value: string, replace = false) {
    const loaded = await apiFetch<{ state: string }>(`/api/requirements/${req}/collaboration`, { method: 'POST', body: {} })
    const doc = new Y.Doc()
    Y.applyUpdate(doc, decodeCollaborationState(loaded.state))
    const updates: Uint8Array[] = []
    doc.on('update', update => updates.push(update))
    doc.transact(() => {
      const block = doc.getXmlFragment('default').get(0) as Y.XmlElement
      let text = block.get(0) as Y.XmlText | undefined
      if (!(text instanceof Y.XmlText)) { text = new Y.XmlText(); block.insert(0, [text]) }
      if (replace) text.delete(0, text.length)
      text.insert(0, value)
    })
    const update = Y.mergeUpdates(updates)
    const event = { id: `edit_${nanoid(24)}`, clientId: doc.clientID, intent: 'edit', update: Buffer.from(update).toString('base64') }
    doc.destroy()
    const body = { editEpoch: epoch, edits: [event] }
    await apiFetch(`/api/requirements/${req}/edits`, { method: 'POST', body })
    return body
  }

  describe('AI 直接编辑 API', () => {
    it('提示块 AI 创建拒绝非法语气并导出四种枚举', async () => {
      const pat = await credential()
      const schema = await agent(pat.token, 'schema')
      expect(schema.capabilities).toContain('callout_tones')
      expect(schema.nodes.callout.attrs.tone.enum).toEqual(['note', 'tip', 'warning', 'danger'])
      await expect(agent(pat.token, 'operations', { action: 'create', requestId: nanoid(24), title: '非法提示块', changeNote: '校验',
        contentJson: { type: 'doc', content: [{ type: 'callout', attrs: { tone: 'info' }, content: [{ type: 'text', text: '不应写入' }] }] } })).rejects.toMatchObject({ statusCode: 422 })
      const created = await agent(pat.token, 'operations', { action: 'create', requestId: nanoid(24), title: '风险提示块', changeNote: '四种语气',
        contentJson: { type: 'doc', content: [{ type: 'callout', attrs: { tone: 'danger' }, content: [{ type: 'text', text: '风险内容' }] }] } })
      expect(created.document.contentJson.content[0].attrs.tone).toBe('danger')
    })
    it.each([
      { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1' }] },
      { type: 'image', attrs: { src: 'https://example.com/trailing.png', align: 'center' }, content: [{ type: 'imageCaption' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
    ])('AI 创建和更新 $type 结尾的正文，正式版与共同文档在打开前即带尾段', async node => {
      const pat = await credential()
      const created = await agent(pat.token, 'operations', { action: 'create', requestId: nanoid(24), title: 'API 尾段', changeNote: '完整初始版本',
        contentJson: { type: 'doc', content: [node] } })
      const id = created.requirementId
      expect(created.document.contentJson.content.map((block: any) => block.type)).toEqual([node.type, 'paragraph'])
      const initial = await apiFetch<Record<string, any>>(`/api/requirements/${id}`)
      expect(initial.currentRevision.contentJson).toEqual(created.document.contentJson)
      expect((await agent(pat.token, `requirements/${id}/status`)).modified).toBe(false)
      const snapshot = await agent<AgentSnapshotDto>(pat.token, `requirements/${id}/snapshot`, {})
      const last = snapshot.contentJson.content.at(-1)!
      const updated = await agent(pat.token, 'operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '末尾改为标题',
        operations: [{ op: 'replace_block', targetDiffId: last.attrs!.diffId, node: { type: 'heading', attrs: { diffId: last.attrs!.diffId, level: 2 }, content: [{ type: 'text', text: '结尾标题' }] } }],
        saveRevision: { changeNote: '保存带规范尾段的正文' } })
      expect(updated.document.contentJson.content.map((block: any) => block.type)).toEqual([node.type, 'heading', 'paragraph'])
      const loaded = await apiFetch<{ state: string }>(`/api/requirements/${id}/collaboration`, { method: 'POST', body: {} })
      const doc = new Y.Doc()
      try {
        Y.applyUpdate(doc, decodeCollaborationState(loaded.state))
        expect(readCollaborationDocument(doc).contentJson).toEqual(updated.document.contentJson)
      } finally { doc.destroy() }
      expect((await apiFetch<Record<string, any>>(`/api/requirements/${id}`)).currentRevision.contentJson).toEqual(updated.document.contentJson)
      expect((await agent(pat.token, `requirements/${id}/status`)).modified).toBe(false)
    })

    it('凭证只保存哈希；不能绕过会话访问旧审核入口；撤销、到期、停用和移出项目后失效', async () => {
      const f = await fixture()
      const tokens = await apiFetch<{ items: Record<string, unknown>[] }>('/api/account/agent-tokens')
      expect(tokens.items[0]).not.toHaveProperty('tokenHash')
      expect(tokens.items[0]).not.toHaveProperty('token')
      await database(async db => {
        const row = await db.query.agentTokens.findFirst({ where: eq(agentTokens.id, f.pat.id) })
        expect(row!.tokenHash).toBe(createHash('sha256').update(f.pat.token).digest('hex'))
      })
      const schema = await agent(f.pat.token, 'schema')
      expect(schema.nodes.table).toBeDefined()
      await expect($fetch('/api/agent/v1/schema')).rejects.toMatchObject({ statusCode: 401 })
      const suggestion = await agent(f.pat.token, 'operations', f.proposal)
      await expect($fetch(`/api/suggestions/${suggestion.id}/review`, { method: 'POST', headers: { authorization: `Bearer ${f.pat.token}` }, body: { action: 'apply' } })).rejects.toMatchObject({ statusCode: 401 })
      await database(db => db.update(users).set({ banned: true }).where(eq(users.id, seedIds.currentUserId)))
      await expect(agent(f.pat.token, 'schema')).rejects.toMatchObject({ statusCode: 403 })
      await database(db => db.update(users).set({ banned: false }).where(eq(users.id, seedIds.currentUserId)))
      await database(db => db.delete(projectMembers).where(and(eq(projectMembers.userId, seedIds.currentUserId), eq(projectMembers.projectId, seedIds.projectId))))
      await expect(agent(f.pat.token, 'schema')).rejects.toMatchObject({ statusCode: 403 })
      await database(db => db.insert(projectMembers).values({ projectId: seedIds.projectId, userId: seedIds.currentUserId }))
      await apiFetch(`/api/account/agent-tokens/${f.pat.id}/revoke`, { method: 'POST' })
      await expect(agent(f.pat.token, 'schema')).rejects.toMatchObject({ statusCode: 401 })
      const expired = await credential()
      await database(db => db.update(agentTokens).set({ expiresAt: new Date(0) }).where(eq(agentTokens.id, expired.id)))
      await expect(agent(expired.token, 'schema')).rejects.toMatchObject({ statusCode: 401 })
    })

    it('下载的 Skill 包完整，支持按标注格式自动识别且无需安装依赖', async () => {
      const pat = await credential()
      const blob = await apiFetch<Blob>('/api/account/agent-skill', { responseType: 'blob' })
      const tar = gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8')
      for (const path of skillFiles) expect(tar).toContain(`requirement-board/${path}\0`)
      for (const path of ['scripts/rb.mjs', 'SKILL.md', 'references/operations.md']) {
        expect(tar).toContain(await readFile(`skills/requirement-board/${path}`, 'utf8'))
      }
      expect(tar).toContain('allow_implicit_invocation: true')
      expect(tar).toContain('RB_BASE_URL')
      expect(tar).not.toContain(pat.token)
      expect(tar).not.toContain('requirement-board/config.json\0')
    })

    it('AI 无登录即可读取安装说明和通用 Skill，仍不能访问凭证和需求', async () => {
      const pat = await credential()
      const guide = await $fetch<string>(`/api/agent/setup?token=${pat.token}`, { responseType: 'text' })
      expect(guide).toContain('/api/agent/skill')
      expect(guide).toContain('--open-terminal --base-url')
      expect(guide).not.toContain(pat.token)
      for (const action of ['update', 'uninstall']) {
        const instructions = await $fetch<string>(`/api/agent/setup?action=${action}`, { responseType: 'text' })
        expect(instructions).toContain(action === 'update' ? 'update --from-bundle --base-url' : "install.mjs' uninstall")
        expect(instructions).not.toContain(pat.token)
      }
      await expect($fetch('/api/agent/setup?action=delete-all')).rejects.toMatchObject({ statusCode: 400 })
      await expect($fetch('/api/agent/setup?action=update&action=uninstall')).rejects.toMatchObject({ statusCode: 400 })
      const publicBlob = await $fetch<Blob>('/api/agent/skill', { responseType: 'blob' })
      const privateBlob = await apiFetch<Blob>('/api/account/agent-skill', { responseType: 'blob' })
      expect(Buffer.from(await publicBlob.arrayBuffer())).toEqual(Buffer.from(await privateBlob.arrayBuffer()))
      const tar = gunzipSync(Buffer.from(await publicBlob.arrayBuffer())).toString('utf8')
      expect(tar).toContain('requirement-board/scripts/terminal.mjs\0')
      expect(tar).not.toContain(pat.token)
      for (const path of ['/api/account/agent-skill', '/api/account/agent-tokens', '/api/agent/v1/schema', '/api/requirements']) {
        await expect($fetch(path)).rejects.toMatchObject({ statusCode: 401 })
      }
    })

    it('执行后拒绝旧编辑和旧保存入口，已确认编辑的重试仍然幂等，新 epoch 可继续编辑保存', async () => {
      const f = await fixture()
      await agent(f.pat.token, `requirements/${f.req.id}/lock`, { snapshotId: f.snapshot.id, action: 'release' })
      const acceptedEdit = await editBody(f.req.id, 1, '原编辑：')
      const snapshot = await agent<AgentSnapshotDto>(f.pat.token, `requirements/${f.req.id}/snapshot`, {})
      const old = await apiFetch<{ state: string }>(`/api/requirements/${f.req.id}/collaboration`, { method: 'POST', body: {} })
      const suggestion = await agent(f.pat.token, 'operations', { ...f.proposal, snapshotId: snapshot.id })
      await apiFetch(`/api/requirements/${f.req.id}/edits`, { method: 'POST', body: acceptedEdit })
      await expect(editBody(f.req.id, 0, '过期：')).rejects.toMatchObject({ statusCode: 409 })
      const oldSave = { title: f.snapshot.title, contentJson: f.snapshot.contentJson, changeNote: '', collaborationUpdate: old.state }
      await expect(apiFetch(`/api/requirements/${f.req.id}/revisions`, { method: 'POST', body: oldSave })).rejects.toMatchObject({ statusCode: 409 })
      await expect(apiFetch(`/api/requirements/${f.req.id}/revisions`, { method: 'POST', body: { title: f.snapshot.title, contentJson: f.snapshot.contentJson } })).rejects.toMatchObject({ statusCode: 409 })
      await expect(apiFetch(`/api/requirements/${f.req.id}/revisions`, { method: 'POST', body: { editEpoch: 3, title: f.snapshot.title, contentJson: f.snapshot.contentJson } })).rejects.toMatchObject({ statusCode: 409 })
      await editBody(f.req.id, 3, '复核后：')
      const latest = await apiFetch<{ state: string }>(`/api/requirements/${f.req.id}/collaboration`, { method: 'POST', body: {} })
      const doc = new Y.Doc()
      Y.applyUpdate(doc, decodeCollaborationState(latest.state))
      try {
        const revision = await apiFetch<any>(`/api/requirements/${f.req.id}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(doc), editEpoch: 3, collaborationUpdate: encodeCollaborationState(doc), changeNote: '人工确认' } })
        expect(revision.title).toBe('补充后的需求标题')
        expect(revision.contentText).toContain('复核后：原编辑：')
      } finally { doc.destroy() }
    })

    it('拒绝过期读取快照和非法结构，失败不留下操作', async () => {
      const f = await fixture()
      await expect(agent(f.pat.token, 'operations', { ...f.proposal, operations: [{ op: 'replace_block', targetDiffId: 'missing', node: { type: 'paragraph' } }] })).rejects.toMatchObject({ statusCode: 422 })
      await database(db => db.update(agentSnapshots).set({ expiresAt: new Date(0) }).where(eq(agentSnapshots.id, f.snapshot.id)))
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 410 })
      await database(async db => { expect(await db.select().from(agentSuggestions)).toHaveLength(0) })
    })

    it('读取锁定的是当前草稿，所有普通写入口只读，其他凭证不能抢占', async () => {
      const req = await createRequirement('正式版本标题')
      await editBody(req.id, 0, '尚未保存版本的草稿：')
      const pat = await credential()
      const snapshot = await agent<AgentSnapshotDto>(pat.token, `requirements/${req.id}/snapshot`, {})
      expect(snapshot.title).toBe('正式版本标题')
      expect(JSON.stringify(snapshot.contentJson)).toContain('尚未保存版本的草稿：')
      expect(snapshot.lock.userId).toBe(seedIds.currentUserId)
      expect((await agent(pat.token, `requirements/${req.id}/snapshot`, {})).id).toBe(snapshot.id)
      const path = `/api/requirements/${req.id}`
      const loaded = await apiFetch<any>(`${path}/collaboration`, { method: 'POST', body: {} })
      expect(loaded.agentLock.snapshotId).toBe(snapshot.id)
      expect((await apiFetch<any>(`${path}/agent-lock`)).canRelease).toBe(true)
      for (const body of [{ title: '偷偷改名' }, { priority: 'high' }, { statusId: seedIds.progressStatusId }, { assigneeIds: [seedIds.frontendUserId] }]) {
        await expect(apiFetch(path, { method: 'PATCH', body })).rejects.toMatchObject({ statusCode: 423 })
      }
      await expect(editBody(req.id, loaded.editEpoch, '越过前端：')).rejects.toMatchObject({ statusCode: 423 })
      const version = { title: snapshot.title, contentJson: snapshot.contentJson, editEpoch: loaded.editEpoch }
      await expect(apiFetch(`${path}/revisions`, { method: 'POST', body: version })).rejects.toMatchObject({ statusCode: 423 })
      await expect(apiFetch(`${path}/revisions`, { method: 'POST', body: { ...version, collaborationUpdate: loaded.state } })).rejects.toMatchObject({ statusCode: 423 })
      await expect(apiFetch(`/api/assets/upload?requirementId=${req.id}`, { method: 'POST' })).rejects.toMatchObject({ statusCode: 423 })
      const other = await credential()
      await expect(agent(other.token, `requirements/${req.id}/snapshot`, {})).rejects.toMatchObject({ statusCode: 423 })
      await expect(agent(other.token, `requirements/${req.id}/lock`, { snapshotId: snapshot.id, action: 'release' })).rejects.toMatchObject({ statusCode: 403 })
      await apiFetch(`${path}/agent-lock`, { method: 'POST', body: { snapshotId: snapshot.id } })
      await apiFetch(path, { method: 'PATCH', body: { priority: 'high' } })
      await editBody(req.id, loaded.editEpoch, '解锁后：')
      expect(await apiFetch(`${path}/revisions`)).toHaveLength(1)
    })

    it('其他成员只能读取，管理员也不能绕过锁写入，但可明确取消', async () => {
      const f = await fixture()
      const admin = await login('admin', TEST_ADMIN_PASSWORD)
      await admin('/api/admin/users', { method: 'POST', body: { name: '阅读同事', username: 'lock.reader', email: 'lock.reader@example.com', password: TEST_USER_PASSWORD, roles: [] } })
      const reader = await login('lock.reader', TEST_USER_PASSWORD)
      const path = `/api/requirements/${f.req.id}`
      expect((await reader(`${path}/agent-lock`)).canRelease).toBe(false)
      expect((await reader(`${path}/collaboration`, { method: 'POST', body: {} })).agentLock.userId).toBe(seedIds.currentUserId)
      await expect(reader(path, { method: 'PATCH', body: { priority: 'high' } })).rejects.toMatchObject({ statusCode: 423 })
      await expect(reader(`${path}/agent-lock`, { method: 'POST', body: { snapshotId: f.snapshot.id } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(admin(path, { method: 'PATCH', body: { priority: 'high' } })).rejects.toMatchObject({ statusCode: 423 })
      expect((await admin(`${path}/agent-lock`)).canRelease).toBe(true)
      await admin(`${path}/agent-lock`, { method: 'POST', body: { snapshotId: f.snapshot.id } })
      await reader(path, { method: 'PATCH', body: { priority: 'high' } })
    })

    it('AI 读取与人工输入竞争时，读取基线包含已确认修改或拒绝迟到输入', async () => {
      const req = await createRequirement('锁竞争')
      const pat = await credential()
      await apiFetch(`/api/requirements/${req.id}/collaboration`, { method: 'POST', body: {} })
      const outcomes = await Promise.allSettled([
        agent<AgentSnapshotDto>(pat.token, `requirements/${req.id}/snapshot`, {}),
        editBody(req.id, 0, '先输入：'),
      ])
      expect(outcomes[0].status).toBe('fulfilled')
      const snapshot = (outcomes[0] as PromiseFulfilledResult<AgentSnapshotDto>).value
      expect(snapshot.title).toBe('锁竞争')
      if (outcomes[1].status === 'fulfilled') expect(JSON.stringify(snapshot.contentJson)).toContain('先输入：')
      else {
        expect([409, 423]).toContain(outcomes[1].reason.statusCode)
        expect(JSON.stringify(snapshot.contentJson)).not.toContain('先输入：')
      }
      expect((await apiFetch<any>(`/api/requirements/${req.id}/agent-lock`)).lock.snapshotId).toBe(snapshot.id)
    })

    // 模拟进程在冻结请求后、执行事务前中断，验证重试与取消的恢复边界。
    async function stage(f: Awaited<ReturnType<typeof fixture>> & { proposal: { completedAnnotations?: { id: string; fingerprint: string }[] } }) {
      const preview = await agent(f.pat.token, 'operations/validate', f.proposal)
      const id = 'suggestion_' + nanoid(24)
      await database(async db => {
        await db.insert(agentSuggestions).values({ id, snapshotId: f.snapshot.id, requirementId: f.req.id, projectId: seedIds.projectId,
          kind: 'update', executionMode: 'takeover', userId: seedIds.currentUserId, requestId: f.proposal.requestId,
          requestHash: createHash('sha256').update(JSON.stringify({ input: f.proposal, executionMode: 'takeover' })).digest('hex'),
          changeNote: f.proposal.changeNote, operations: f.proposal.operations, completedAnnotations: f.proposal.completedAnnotations, ...preview.candidate })
        await db.update(requirementAgentLocks).set({ suggestionId: id }).where(eq(requirementAgentLocks.requirementId, f.req.id))
      })
      return id
    }

    it('校验不写入，默认直接修改草稿；并发重复请求只执行一次且不保存版本', async () => {
      const f = await fixture()
      expect((await agent(f.pat.token, 'operations/validate', f.proposal)).valid).toBe(true)
      expect(await database(db => db.select().from(agentSuggestions))).toHaveLength(0)
      expect((await agent(f.pat.token, 'requirements/' + f.req.id)).title).toBe(f.snapshot.title)
      const results = await Promise.all([1, 2].map(() => agent(f.pat.token, 'operations', f.proposal)))
      expect(results[0]).toEqual(results[1])
      expect(results[0]).toMatchObject({ status: 'applied', requirementId: f.req.id, documentUrl: '/requirements/' + f.req.id, revision: null })
      expect(results[0]).not.toHaveProperty('reviewUrl')
      await expect(agent(f.pat.token, 'operations', { ...f.proposal, changeNote: '不同请求' })).rejects.toMatchObject({ statusCode: 409 })
      expect(await agent(f.pat.token, 'operations/' + results[0].id)).toEqual(results[0])
      const other = await login('admin', TEST_ADMIN_PASSWORD)
      const otherToken = await other('/api/account/agent-tokens', { method: 'POST', body: { name: '另一发起人' } })
      await expect(agent(otherToken.token, 'operations/' + results[0].id)).rejects.toMatchObject({ statusCode: 404 })
      await database(async db => {
        const doc = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, f.req.id) })
        expect(doc).toMatchObject({ title: '补充后的需求标题', editEpoch: 2, contentJson: f.snapshot.contentJson })
        expect(await db.select().from(requirementEditEvents).where(eq(requirementEditEvents.requirementId, f.req.id))).toHaveLength(1)
        expect(await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, results[0].id), eq(auditEvents.action, 'agent.suggestion.apply')))).toHaveLength(1)
      })
      expect(await apiFetch('/api/requirements/' + f.req.id + '/revisions')).toHaveLength(1)
      expect((await apiFetch<any>('/api/requirements/' + f.req.id + '/agent-lock')).lock).toBeNull()
    })

    it('标注完成回执仅在执行成功后可由原账号和文档读取，验证/失败/取消不清除', async () => {
      const f = await fixture()
      const annotations = [{ id: 'annotation-one', fingerprint: 'a'.repeat(64) }, { id: 'annotation-two', fingerprint: 'b'.repeat(64) }]
      const proposal = { ...f.proposal, completedAnnotations: annotations }
      const path = `/api/requirements/${f.req.id}/annotation-completions`
      const query = { method: 'POST', body: { annotations } }
      await expect($fetch(path, query)).rejects.toMatchObject({ statusCode: 401 })
      await expect(apiFetch(path, { method: 'POST', body: { annotations: [annotations[0], annotations[0]] } })).rejects.toMatchObject({ statusCode: 400 })
      await agent(f.pat.token, 'operations/validate', proposal)
      expect(await apiFetch(path, query)).toEqual({ completed: [] })
      await expect(agent(f.pat.token, 'operations', { ...proposal, operations: [{ op: 'delete_block', targetDiffId: 'missing' }] })).rejects.toMatchObject({ statusCode: 422 })
      expect(await apiFetch(path, query)).toEqual({ completed: [] })
      const operation = await agent(f.pat.token, 'operations', proposal)
      expect(operation).toMatchObject({ status: 'applied', completedAnnotations: annotations, revision: null })
      expect(await apiFetch(path, query)).toEqual({ completed: annotations })
      expect(await agent(f.pat.token, 'operations', proposal)).toEqual(operation)
      expect(await agent(f.pat.token, `operations/${operation.id}`)).toEqual(operation)
      expect(await apiFetch(path, { method: 'POST', body: { annotations: [{ ...annotations[0], fingerprint: 'c'.repeat(64) }] } })).toEqual({ completed: [] })
      const other = await login('admin', TEST_ADMIN_PASSWORD)
      expect(await other(path, query)).toEqual({ completed: [] })
      const another = await createRequirement('另一文档')
      expect(await apiFetch(`/api/requirements/${another.id}/annotation-completions`, query)).toEqual({ completed: [] })
      await expect(apiFetch('/api/requirements/missing/annotation-completions', query)).rejects.toMatchObject({ statusCode: 404 })
      const cancelled = await fixture()
      const staged = { ...cancelled, proposal: { ...cancelled.proposal, completedAnnotations: annotations } }
      const pendingId = await stage(staged)
      const cancelledPath = `/api/requirements/${cancelled.req.id}/annotation-completions`
      expect(await apiFetch(cancelledPath, query)).toEqual({ completed: [] })
      expect((await agent(cancelled.pat.token, `operations/${pendingId}`)).completedAnnotations).toEqual([])
      await agent(cancelled.pat.token, `requirements/${cancelled.req.id}/lock`, { snapshotId: cancelled.snapshot.id, action: 'release' })
      expect(await apiFetch(cancelledPath, query)).toEqual({ completed: [] })
      expect((await agent(cancelled.pat.token, 'operations', staged.proposal)).completedAnnotations).toEqual([])
    })

    it('标注确认仅回收本人匹配的成功回执，并发/重复确认及重试均不恢复已回收条目', async () => {
      const f = await fixture()
      const annotations = ['a', 'b', 'c'].map(id => ({ id, fingerprint: id.repeat(64) }))
      const proposal = { ...f.proposal, completedAnnotations: annotations }
      const operation = await agent(f.pat.token, 'operations', proposal)
      const path = `/api/requirements/${f.req.id}/annotation-completions`
      const query = { method: 'POST', body: { annotations } }
      const original = await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, operation.id) }))
      await expect($fetch(`${path}/ack`, query)).rejects.toMatchObject({ statusCode: 401 })
      await expect(apiFetch(`${path}/ack`, { method: 'POST', body: { annotations: [{ id: 'a', fingerprint: 'invalid' }] } })).rejects.toMatchObject({ statusCode: 400 })
      const other = await login('admin', TEST_ADMIN_PASSWORD)
      expect(await other(`${path}/ack`, query)).toEqual({ acknowledged: true })
      const another = await createRequirement('不受确认影响的文档')
      await apiFetch(`/api/requirements/${another.id}/annotation-completions/ack`, query)
      await apiFetch(`${path}/ack`, { method: 'POST', body: { annotations: [{ id: 'a', fingerprint: 'd'.repeat(64) }] } })
      expect(await apiFetch(path, query)).toEqual({ completed: annotations })
      await apiFetch(`${path}/ack`, { method: 'POST', body: { annotations: [annotations[0]] } })
      expect(await apiFetch(path, query)).toEqual({ completed: annotations.slice(1) })
      expect(await agent(f.pat.token, 'operations', proposal)).toEqual({ ...operation, completedAnnotations: annotations.slice(1) })
      await Promise.all(annotations.slice(1).map(item => apiFetch(`${path}/ack`, { method: 'POST', body: { annotations: [item] } })))
      expect(await apiFetch(`${path}/ack`, query)).toEqual({ acknowledged: true })
      expect(await apiFetch(path, query)).toEqual({ completed: [] })
      expect(await agent(f.pat.token, 'operations', proposal)).toEqual({ ...operation, completedAnnotations: [] })
      expect(await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, operation.id) })))
        .toEqual({ ...original, completedAnnotations: null })
      const pending = await fixture()
      const staged = { ...pending, proposal: { ...pending.proposal, completedAnnotations: annotations } }
      const pendingId = await stage(staged)
      await apiFetch(`/api/requirements/${pending.req.id}/annotation-completions/ack`, query)
      expect((await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, pendingId) })))?.completedAnnotations).toEqual(annotations)
    })

    it('完成信息成功后保留七天，到期立即停止返回并由清理任务回收，操作记录和幂等不受影响', async () => {
      const annotations = [{ id: 'expired-note', fingerprint: 'e'.repeat(64) }]
      const fresh = await fixture(), expired = await fixture()
      const freshProposal = { ...fresh.proposal, completedAnnotations: annotations }
      const expiredProposal = { ...expired.proposal, completedAnnotations: annotations }
      const freshResult = await agent(fresh.pat.token, 'operations', freshProposal)
      const expiredResult = await agent(expired.pat.token, 'operations', expiredProposal)
      const now = Date.now(), boundary = new Date(now - ANNOTATION_COMPLETION_RETENTION_MS)
      await database(async db => {
        await db.update(agentSuggestions).set({ createdAt: new Date(boundary.getTime() - 1000) }).where(eq(agentSuggestions.id, freshResult.id))
        await db.update(agentSuggestions).set({ reviewedAt: boundary }).where(eq(agentSuggestions.id, expiredResult.id))
      })
      const path = `/api/requirements/${expired.req.id}/annotation-completions`
      const query = { method: 'POST', body: { annotations } }
      expect(await apiFetch(path, query)).toEqual({ completed: [] })
      expect(await agent(expired.pat.token, `operations/${expiredResult.id}`)).toEqual({ ...expiredResult, completedAnnotations: [] })
      const original = await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, expiredResult.id) }))
      expect(original?.completedAnnotations).toEqual(annotations)
      await database(db => expireAnnotationCompletions(db, now - 1))
      expect((await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, expiredResult.id) })))?.completedAnnotations).toEqual(annotations)
      await database(db => expireAnnotationCompletions(db, now))
      expect(await database(db => db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, expiredResult.id) })))
        .toEqual({ ...original, completedAnnotations: null })
      expect(await apiFetch(`/api/requirements/${fresh.req.id}/annotation-completions`, query)).toEqual({ completed: annotations })
      expect(await agent(expired.pat.token, 'operations', expiredProposal)).toEqual({ ...expiredResult, completedAnnotations: [] })
      const pending = await fixture()
      const pendingId = await stage({ ...pending, proposal: { ...pending.proposal, completedAnnotations: annotations } })
      await database(async db => {
        await db.update(agentSuggestions).set({ createdAt: boundary }).where(eq(agentSuggestions.id, pendingId))
        await expireAnnotationCompletions(db, now)
        expect(await db.query.agentSuggestions.findFirst({ where: eq(agentSuggestions.id, pendingId) }))
          .toMatchObject({ status: 'pending', completedAnnotations: null })
      })
    })

    it('旧审核接口停用，旧请求和审核模式不能被意外执行', async () => {
      const f = await fixture()
      const schema = await agent(f.pat.token, 'schema')
      expect(schema.capabilitiesVersion).toBe(13)
      expect(schema.annotationNodes.callout).toEqual({ version: 1, label: '提示块' })
      expect(schema.capabilities).toContain('direct_execution')
      expect(schema.capabilities).not.toContain('review')
      await expect(agent(f.pat.token, 'suggestions', f.proposal)).rejects.toMatchObject({ statusCode: 410 })
      await expect(agent(f.pat.token, 'suggestions/validate', f.proposal)).rejects.toMatchObject({ statusCode: 410 })
      const id = await stage(f)
      await database(db => db.update(agentSuggestions).set({ executionMode: 'review', requestHash: createHash('sha256').update(JSON.stringify(f.proposal)).digest('hex') }).where(eq(agentSuggestions.id, id)))
      await expect(apiFetch('/api/suggestions/' + id + '/review', { method: 'POST', body: { action: 'apply' } })).rejects.toMatchObject({ statusCode: 410 })
      await expect(apiFetch('/api/requirements/' + f.req.id + '/suggestions')).rejects.toMatchObject({ statusCode: 410 })
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 409 })
      await expect($fetch('/api/agent/v1/operations', { method: 'POST', headers: { authorization: 'Bearer ' + f.pat.token, 'x-rb-mode': 'review' }, body: f.proposal })).rejects.toMatchObject({ statusCode: 400 })
      expect((await agent(f.pat.token, 'requirements/' + f.req.id)).title).toBe(f.snapshot.title)
    })

    it('中断后的同一请求可继续执行；取消会终止请求并保持原草稿', async () => {
      const f = await fixture(), id = await stage(f)
      await agent(f.pat.token, 'requirements/' + f.req.id + '/lock', { snapshotId: f.snapshot.id, action: 'release' })
      expect(await agent(f.pat.token, 'operations', f.proposal)).toMatchObject({ id, status: 'rejected', revision: null })
      expect((await agent(f.pat.token, 'requirements/' + f.req.id)).title).toBe(f.snapshot.title)
      const next = await fixture(), nextId = await stage(next)
      expect(await agent(next.pat.token, 'operations', next.proposal)).toMatchObject({ id: nextId, status: 'applied' })
    })

    it('中断重试重新检查草稿、协议与新一轮锁，不能覆盖人工修改', async () => {
      const f = await fixture(), id = await stage(f)
      await database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, f.req.id)))
      await editBody(f.req.id, 1, '人工修改：')
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 409 })
      expect((await agent(f.pat.token, 'operations/' + id)).status).toBe('pending')
      await editBody(f.req.id, 1, f.snapshot.contentJson.content[0]!.content?.[0]?.text ?? '', true)
      const next = await agent(f.pat.token, 'requirements/' + f.req.id + '/snapshot', {})
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 423 })
      await agent(f.pat.token, 'requirements/' + f.req.id + '/lock', { snapshotId: next.id, action: 'release' })
      await database(db => db.update(agentSnapshots).set({ schemaVersion: 999 }).where(eq(agentSnapshots.id, f.snapshot.id)))
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 409 })
      await database(db => db.update(agentSnapshots).set({ schemaVersion: 3 }).where(eq(agentSnapshots.id, f.snapshot.id)))
      expect((await agent(f.pat.token, 'operations', f.proposal)).status).toBe('applied')
    })

    it('重试与人工写入竞争时只有一方成功，人工内容不会丢失', async () => {
      const f = await fixture()
      await stage(f)
      await database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, f.req.id)))
      const outcomes = await Promise.allSettled([agent(f.pat.token, 'operations', f.proposal), editBody(f.req.id, 1, '竞争写入：')])
      expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
      expect([409, 423]).toContain((outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult).reason.statusCode)
      const current = await agent(f.pat.token, 'requirements/' + f.req.id)
      expect(current.title).toBe(outcomes[1].status === 'fulfilled' ? f.snapshot.title : '补充后的需求标题')
      expect(JSON.stringify(current.contentJson).includes('竞争写入：')).toBe(outcomes[1].status === 'fulfilled')
    })

    it('续锁、过期、重新读取和撤销凭证保持独占边界', async () => {
      const f = await fixture()
      await database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(Date.now() + 1000) }).where(eq(requirementAgentLocks.requirementId, f.req.id)))
      const renewed = await agent(f.pat.token, 'requirements/' + f.req.id + '/lock', { snapshotId: f.snapshot.id, action: 'renew' })
      expect(Date.parse(renewed.lock.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000)
      await database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, f.req.id)))
      await expect(agent(f.pat.token, 'operations', f.proposal)).rejects.toMatchObject({ statusCode: 409 })
      const next = await agent(f.pat.token, 'requirements/' + f.req.id + '/snapshot', {})
      expect(next.id).not.toBe(f.snapshot.id)
      await apiFetch('/api/account/agent-tokens/' + f.pat.id + '/revoke', { method: 'POST' })
      expect((await apiFetch<any>('/api/requirements/' + f.req.id + '/agent-lock')).lock).toBeNull()
      await editBody(f.req.id, 2, '撤销后：')
    })

    it('GC 保留操作收据引用的图片和过期基线，孤立过期快照经过宽限期后才释放', async () => {
      const f = await fixture()
      const assetId = `asset_${nanoid(12)}`, url = `/uploads/${assetId}.png`
      await database(db => db.insert(assets).values({ id: assetId, requirementId: f.req.id, fileName: `${assetId}.png`,
        url, mimeType: 'image/png', size: 1, uploadedById: seedIds.currentUserId, createdAt: new Date(0) }))
      const prepared = { ...f.proposal, operations: [{ op: 'insert_blocks',
        anchorDiffId: f.snapshot.contentJson.content[0]!.attrs!.diffId, position: 'after', nodes: [{ type: 'image',
          attrs: { src: url, align: 'center' }, content: [{ type: 'imageCaption' }] }] }] }
      const suggestion = { id: await stage({ ...f, proposal: prepared as typeof f.proposal }) }
      await agent(f.pat.token, `requirements/${f.req.id}/lock`, { snapshotId: f.snapshot.id, action: 'release' })
      await database(async db => {
        await db.update(agentSnapshots).set({ expiresAt: new Date(0) }).where(eq(agentSnapshots.id, f.snapshot.id))
        const storage = { async put() {}, async get() { return null }, async remove() { throw new Error('dry-run must not delete files') }, close() {} }
        const protectedResult = await garbageCollectAssets(db, { storage, dryRun: true })
        expect(protectedResult.candidates).not.toContain(assetId)
        expect(await db.query.agentSnapshots.findFirst({ where: eq(agentSnapshots.id, f.snapshot.id) })).toBeDefined()
        await db.delete(agentSuggestions).where(eq(agentSuggestions.id, suggestion.id))
        const released = await garbageCollectAssets(db, { storage, dryRun: true })
        expect(released.candidates).toContain(assetId)
        expect(await db.query.agentSnapshots.findFirst({ where: eq(agentSnapshots.id, f.snapshot.id) })).toBeDefined()
      })
    })
  })
}
