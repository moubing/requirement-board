import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../../server/db/client'
import { requirementEditEvents, requirementRevisions } from '../../server/db/schema'
import { createCollaborationDocument, decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import type { AttributionSnapshot, CollaborationEdit } from '../../shared/collaboration/attribution'
import { TEST_ADMIN_PASSWORD, TEST_DATABASE_URL, TEST_USER_PASSWORD } from '../setup/db'

type Api = <T = any>(url: string, options?: Record<string, any>) => Promise<T>
interface Harness { apiFetch: Api; createRequirement: (title?: string) => Promise<Record<string, any>>; readSessionCookie: (response: Response) => string }
const names = (snapshot: AttributionSnapshot, id = 'p_authors') => snapshot.nodes.find(node => node.id === id)?.authors.map(author => author.name) ?? []

export function registerAttributionTests({ apiFetch, createRequirement, readSessionCookie }: Harness) {
  async function login(username: string, password: string): Promise<Api> {
    const response = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    expect(response.status).toBe(200)
    const cookie = readSessionCookie(response)
    return (url, options = {}) => $fetch(url, { ...options, headers: { 'x-rb-document-schema': '3', 'x-rb-document-capabilities': 'task_lists,details', ...options.headers, cookie } })
  }
  async function fixture() {
    const requirement = await createRequirement('节点修改人')
    const path = `/api/requirements/${requirement.id}`
    const initialDoc = createCollaborationDocument({ title: '节点修改人', contentJson: { type: 'doc', content: [
      { type: 'paragraph', attrs: { diffId: 'p_authors' } },
      { type: 'paragraph', attrs: { diffId: 'p_unchanged' }, content: [{ type: 'text', text: '没有修改的段落' }] },
    ] } })
    const initial = readCollaborationDocument(initialDoc)
    initialDoc.destroy()
    await apiFetch(`${path}/revisions`, { method: 'POST', body: initial })
    const loaded = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
    const docs: Y.Doc[] = []
    const copy = () => { const doc = new Y.Doc(); Y.applyUpdate(doc, decodeCollaborationState(loaded.state)); docs.push(doc); return doc }
    return { path, initial, copy, close: () => docs.forEach(doc => doc.destroy()) }
  }
  function edit(doc: Y.Doc, work: () => void, intent: CollaborationEdit['intent'] = 'edit'): CollaborationEdit {
    const updates: Uint8Array[] = []
    const collect = (update: Uint8Array) => updates.push(update)
    doc.on('update', collect)
    try { doc.transact(work) } finally { doc.off('update', collect) }
    return { id: `edit_${nanoid(24)}`, clientId: doc.clientID, update: Buffer.from(Y.mergeUpdates(updates)).toString('base64'), intent }
  }
  const paragraph = (doc: Y.Doc) => doc.getXmlFragment('default').get(0) as Y.XmlElement
  const text = (doc: Y.Doc) => paragraph(doc).get(0) as Y.XmlText
  async function submit(path: string, packet: CollaborationEdit | CollaborationEdit[], api = apiFetch) {
    return api(`${path}/edits`, { method: 'POST', body: { edits: Array.isArray(packet) ? packet : [packet] } })
  }

  describe('节点本版修改人 API', () => {
    it('文字和格式编辑去重汇总，保存人独立；新版本重新计数，保存重试不清空新名单', async () => {
      const f = await fixture()
      try {
        const admin = await login('admin', TEST_ADMIN_PASSWORD)
        for (const [name, username] of [['格式编辑者', 'attribution.format'], ['保存者', 'attribution.saver']]) {
          await admin('/api/admin/users', { method: 'POST', body: { name, username, email: `${username}@example.com`, password: TEST_USER_PASSWORD, roles: ['developer'] } })
        }
        const formatApi = await login('attribution.format', TEST_USER_PASSWORD)
        const saverApi = await login('attribution.saver', TEST_USER_PASSWORD)
        const a = f.copy(), b = f.copy(), c = f.copy(), d = f.copy()
        const firstPacket = edit(a, () => paragraph(a).insert(0, [new Y.XmlText('支持导出报表')]))
        const first = await submit(f.path, firstPacket)
        Y.applyUpdate(b, decodeCollaborationState(first.update))
        const second = await submit(f.path, edit(b, () => { text(b).delete(4, 2); text(b).insert(4, 'Excel 文件') }), admin)
        Y.applyUpdate(c, decodeCollaborationState(second.update))
        const third = await submit(f.path, edit(c, () => text(c).format(4, 8, { bold: {} })), formatApi)
        Y.applyUpdate(d, decodeCollaborationState(third.update))
        expect(names(third.snapshot)).toEqual(['Mo Bing', 'admin', '格式编辑者'])
        expect(third.snapshot.nodes.some((node: any) => node.id === 'p_unchanged')).toBe(false)
        const replay = await submit(f.path, firstPacket)
        expect(replay.sequence).toBe(third.sequence)
        const revision = await saverApi(`${f.path}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(d), changeNote: '共同完成',
          collaborationUpdate: encodeCollaborationState(d), clientSaveId: 'attribution_saved_version' } })
        expect(revision.author.name).toBe('保存者')
        expect(revision.attribution).toEqual(third.snapshot)
        expect(revision.attributionSequence).toBe(third.sequence)
        const history = await apiFetch(`${f.path}/attribution`)
        expect(history.snapshot).toMatchObject({ baseRevisionId: revision.id, baseVersion: revision.version, nodes: [] })
        expect(history).not.toHaveProperty('events')
        const before = structuredClone(revision.attribution)
        await submit(f.path, edit(d, () => text(d).insert(text(d).length, '追加')))
        const repeated = await saverApi(`${f.path}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(d), changeNote: '共同完成',
          collaborationUpdate: encodeCollaborationState(d), clientSaveId: 'attribution_saved_version' } })
        expect(repeated.id).toBe(revision.id)
        expect(names((await apiFetch(`${f.path}/attribution`)).snapshot)).toEqual(['Mo Bing'])
        const persisted = await apiFetch(`/api/revisions/${revision.id}`)
        expect(persisted.attribution).toEqual(before)
        const next = await saverApi(`${f.path}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(d), collaborationUpdate: encodeCollaborationState(d) } })
        expect(next.attribution.baseRevisionId).toBe(revision.id)
        expect(names(next.attribution)).toEqual(['Mo Bing'])
        const database = createDatabase(TEST_DATABASE_URL)
        try {
          const records = await database.db.select().from(requirementEditEvents).where(eq(requirementEditEvents.requirementId, f.path.split('/').at(-1)!))
          expect(records).toHaveLength(4)
          expect(records.every(record => record.changes.length === 0)).toBe(true)
          // 已有逐字格式的历史只转换读取结果，数据库历史保持原样。
          await database.db.update(requirementRevisions).set({ attribution: { version: 1, blocks: [] } }).where(eq(requirementRevisions.id, revision.id))
          expect((await apiFetch(`/api/revisions/${revision.id}`)).attribution).toEqual(before)
          const summary = (await apiFetch(`${f.path}/revisions`)).find((row: any) => row.id === revision.id)
          expect(summary.editors.map((author: any) => author.name).sort()).toEqual([...new Set(before.nodes.flatMap(node => node.authors.map(author => author.name)))].sort())
          expect(summary).not.toHaveProperty('contentJson')
          expect(summary).not.toHaveProperty('attribution')
          expect((await apiFetch(`${f.path}/revisions?includeContent=true`)).find((row: any) => row.id === revision.id).attribution).toEqual(before)
          expect((await database.db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.id, revision.id) }))!.attribution!.version).toBe(1)
        } finally { await database.client.end() }
      } finally { f.close() }
    })

    it('离线更新必须按依赖顺序提交，补交和重试不会归给重连副本', async () => {
      const f = await fixture()
      try {
        const doc = f.copy()
        const first = edit(doc, () => paragraph(doc).insert(0, [new Y.XmlText('甲')]))
        const second = edit(doc, () => text(doc).insert(1, '乙'))
        await expect(submit(f.path, second)).rejects.toMatchObject({ statusCode: 409 })
        const result = await submit(f.path, [first, second])
        expect(names(result.snapshot)).toEqual(['Mo Bing'])
        const reopened = await apiFetch(`${f.path}/collaboration`, { method: 'POST', body: {} })
        expect(reopened.attribution).toEqual(result.snapshot)
        expect((await submit(f.path, [first, second])).sequence).toBe(result.sequence)
      } finally { f.close() }
    })

    it('拒绝作者注入、事件篡改和混合状态认领，非法批次全部回滚', async () => {
      const f = await fixture()
      try {
        const doc = f.copy()
        const first = edit(doc, () => paragraph(doc).insert(0, [new Y.XmlText('正文')]))
        await expect(submit(f.path, { ...first, authorId: 'admin' } as CollaborationEdit)).rejects.toMatchObject({ statusCode: 400 })
        await expect(submit(f.path, { ...first, update: encodeCollaborationState(doc) })).rejects.toMatchObject({ statusCode: 400 })
        const invalid = edit(doc, () => paragraph(doc).setAttribute('diffId', ''))
        await expect(submit(f.path, [first, invalid])).rejects.toMatchObject({ statusCode: 400 })
        const other = f.copy()
        const invalidNode = edit(other, () => other.getXmlFragment('default').insert(0, [new Y.XmlElement('notAllowedNode')]))
        await expect(submit(f.path, invalidNode)).rejects.toMatchObject({ statusCode: 400 })
        expect((await apiFetch(`${f.path}/attribution`)).sequence).toBe(0)
        await submit(f.path, first)
        await expect(submit(f.path, { ...invalid, id: first.id })).rejects.toMatchObject({ statusCode: 409 })
        const admin = await login('admin', TEST_ADMIN_PASSWORD)
        await expect(submit(f.path, first, admin)).rejects.toMatchObject({ statusCode: 409 })
      } finally { f.close() }
    })

    it('旧 JSON 的表格默认属性补全不计为节点修改', async () => {
      const requirement = await createRequirement('表格基线')
      const path = `/api/requirements/${requirement.id}`
      await apiFetch(`${path}/revisions`, { method: 'POST', body: { title: '表格基线', contentJson: { type: 'doc', content: [
        { type: 'table', attrs: { diffId: 'table_base' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
          { type: 'paragraph', attrs: { diffId: 'cell_p' }, content: [{ type: 'text', text: '旧正文' }] },
        ] }] }] },
      ] } } })
      const loaded = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
      expect(loaded.attribution.nodes).toEqual([])
    })

    it('旧客户端合并状态的修改人不猜测；未登录不能读取或写入记录', async () => {
      const f = await fixture()
      try {
        const doc = f.copy()
        paragraph(doc).insert(0, [new Y.XmlText('旧客户端内容')])
        const revision = await apiFetch(`${f.path}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(doc), collaborationUpdate: encodeCollaborationState(doc), changeNote: '' } })
        expect(revision.attribution.nodes).toEqual([{ id: 'p_authors', type: 'paragraph', authors: [], unknown: true }])
        expect((await apiFetch(`${f.path}/attribution`)).snapshot.nodes).toEqual([])
        await expect($fetch(`${f.path}/attribution`)).rejects.toMatchObject({ statusCode: 401 })
        await expect($fetch(`${f.path}/edits`, { method: 'POST', body: { edits: [] } })).rejects.toMatchObject({ statusCode: 401 })
        await expect(apiFetch('/api/requirements/req_missing/attribution')).rejects.toMatchObject({ statusCode: 404 })
      } finally { f.close() }
    })

    it('跨保存边界补交离线修改只计入接收时的版本，撤销后仍保留本版参与者', async () => {
      const f = await fixture()
      try {
        const a = f.copy(), offline = f.copy()
        const pending = edit(offline, () => paragraph(offline).insert(0, [new Y.XmlText('离线')]))
        const online = await submit(f.path, edit(a, () => paragraph(a).insert(0, [new Y.XmlText('在线')])))
        Y.applyUpdate(a, decodeCollaborationState(online.update))
        const revision = await apiFetch(`${f.path}/revisions`, { method: 'POST', body: { ...readCollaborationDocument(a), collaborationUpdate: encodeCollaborationState(a) } })
        const admin = await login('admin', TEST_ADMIN_PASSWORD)
        const submitted = await submit(f.path, pending, admin)
        expect(submitted.snapshot.baseRevisionId).toBe(revision.id)
        expect(names(submitted.snapshot)).toEqual(['admin'])
        Y.applyUpdate(a, decodeCollaborationState(submitted.update))
        const bold = edit(a, () => text(a).format(0, text(a).length, { bold: {} }))
        const undo = edit(a, () => text(a).format(0, text(a).length, { bold: null }), 'restore')
        const restored = await submit(f.path, [bold, undo])
        expect(names(restored.snapshot)).toEqual(['admin', 'Mo Bing'])
        expect((await apiFetch(`/api/revisions/${revision.id}`)).attribution).toEqual(revision.attribution)
      } finally { f.close() }
    })
  })
}
