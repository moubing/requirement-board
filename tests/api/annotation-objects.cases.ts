import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { agentSnapshots, agentSuggestions, agentTokens, assets, requirementAgentLocks, requirementCollaborationDocuments, requirementEditEvents, requirementRevisions, requirements } from '../../server/db/schema'
import { createAssetStorage } from '../../server/services/asset-storage'
import { upgradeDocumentSchemas } from '../../server/services/document-schema-upgrade'
import { readCollaborationDocument } from '../../shared/collaboration/document'
import { richTextProseMirrorSchema } from '../../shared/editor/validation'
import { ensureBlockIds, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'
import { captureNodeTarget, annotationFingerprint, resolveAnnotationRequest, assertAnnotationCapabilities, ANNOTATION_REQUIREMENTS, type AnnotationRequest } from '../../shared/agent/annotations'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerAnnotationObjectTests({ apiFetch, createRequirement, uploadsDir }: { apiFetch: Api; createRequirement: () => Promise<any>; uploadsDir: string }) {
  const agent = (token: string, path: string, body?: unknown) => $fetch<any>(`/api/agent/v1/${path}`, {
    headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { method: 'POST' as const, body }),
  })
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const credential = () => apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '对象标注验证' } })
  const paragraph = (text = ''): RichTextNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
  const table = (): RichTextNode => ({ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableHeader', content: [paragraph('标题')] }, { type: 'tableCell', content: [paragraph()] },
  ] }] })
  async function imageFixture() {
    const pat = await credential(), requestId = nanoid(24)
    const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#475569' } }).png().toBuffer()
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)]), '原图.png')
    const asset = await agent(pat.token, `assets/upload?createRequestId=${requestId}&uploadId=${nanoid(24)}`, form)
    const nested = table(); nested.content![0]!.content![1]!.content!.push(structuredClone(asset.node))
    const result = await agent(pat.token, 'operations', { action: 'create', requestId, title: '对象标注', changeNote: '初始内容',
      contentJson: { type: 'doc', content: [asset.node, nested] } })
    return { pat, bytes, asset, req: result.requirementId, imageId: result.document.contentJson.content[0].attrs.diffId }
  }
  describe('对象标注原图与 schema 3 升级', () => {
    it('提示块以通用节点协议完成定位、草稿写入和回执，保留其他正文及历史版本', async () => {
      const pat = await credential()
      const created = await agent(pat.token, 'operations', { action: 'create', requestId: nanoid(24), title: '通用提示块', changeNote: '初始版本',
        contentJson: { type: 'doc', content: [{ type: 'callout', attrs: { tone: 'note' }, content: [{ type: 'text', text: '上手路线' }] }, paragraph('保留段落')] } })
      const createdDocument = await agent(pat.token, `requirements/${created.requirementId}`)
      const snapshot = await agent(pat.token, `requirements/${created.requirementId}/snapshot`, {})
      const block = snapshot.contentJson.content[0], target = captureNodeTarget(snapshot.contentJson, block.attrs.diffId)
      const annotation = { id: nanoid(24), target, quote: target.summary, comment: '改为警告并补充说明', section: '', segments: [] }
      const completion = { id: annotation.id, fingerprint: await annotationFingerprint(annotation, '') }
      const origin = 'https://board.example'
      const payload: AnnotationRequest = { format: 'rb-annotations/v2', requirements: ANNOTATION_REQUIREMENTS, source: 'shared-draft',
        contentToken: snapshot.contentToken, createdAt: new Date().toISOString(), overall: '', annotations: [annotation], completion: [completion],
        document: { id: created.requirementId, key: createdDocument.key, title: snapshot.title, origin, url: `${origin}/requirements/${created.requirementId}` } }
      assertAnnotationCapabilities(payload, await agent(pat.token, 'schema'))
      expect(resolveAnnotationRequest(payload, snapshot, origin)).toMatchObject({ ready: true, topLevelIds: [block.attrs.diffId] })
      const next = structuredClone(block); next.attrs.tone = 'warning'; next.content[0].text = '升级前请确认草稿已同步'
      const action = { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '处理提示块标注', completedAnnotations: [completion],
        operations: [{ op: 'replace_block', targetDiffId: target.blockId, node: next }] }
      const result = await agent(pat.token, 'operations', action)
      expect(result.status).toBe('applied')
      expect(result.completedAnnotations).toEqual([completion])
      const current = await agent(pat.token, `requirements/${created.requirementId}`)
      expect(current.contentJson.content[0]).toEqual(next)
      expect(current.contentJson.content.slice(1)).toEqual(snapshot.contentJson.content.slice(1))
      expect(current.latestRevision.version).toBe(1)
      const history = await database(db => db.select().from(requirementRevisions).where(eq(requirementRevisions.requirementId, created.requirementId)))
      expect(history).toHaveLength(1)
      expect(history[0]!.contentJson.content[0]!.attrs!.tone).toBe('note')
      expect(await apiFetch(`/api/requirements/${created.requirementId}/annotation-completions`, { method: 'POST', body: { annotations: [completion] } })).toEqual({ completed: [completion] })
    })
    it('原图必须是本篇真实引用；当前正文和本人有效快照只读访问、不创建锁或编辑记录', async () => {
      const f = await imageFixture(), path = `requirements/${f.req}/images/${f.imageId}`
      const state = () => database(async db => ({ doc: await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, f.req) }),
        revisions: await db.select().from(requirementRevisions), edits: await db.select().from(requirementEditEvents),
        operations: await db.select().from(agentSuggestions), locks: await db.select().from(requirementAgentLocks) }))
      const before = await state()
      const response = await fetch(`/api/agent/v1/${path}`, { headers: { authorization: `Bearer ${f.pat.token}` } })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes)
      expect(await state()).toEqual(before)
      await expect(agent(f.pat.token, `requirements/${f.req}/images/not-in-document`)).rejects.toMatchObject({ statusCode: 404 })
      const other = await createRequirement()
      await expect(agent(f.pat.token, `requirements/${other.id}/images/${f.imageId}`)).rejects.toMatchObject({ statusCode: 404 })
      const snapshot = await agent(f.pat.token, `requirements/${f.req}/snapshot`, {})
      const snapResponse = await fetch(`/api/agent/v1/${path}?snapshotId=${snapshot.id}`, { headers: { authorization: `Bearer ${f.pat.token}` } })
      expect(snapResponse.status).toBe(200)
      const another = await credential()
      await expect(agent(another.token, `${path}?snapshotId=${snapshot.id}`)).rejects.toMatchObject({ statusCode: 409 })
      await database(db => db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, f.pat.id)))
      await expect(agent(f.pat.token, path)).rejects.toMatchObject({ statusCode: 401 })
    })
    it('拒绝损坏、超大、站外及越权原图，不信任资源 MIME 和声明大小', async () => {
      const f = await imageFixture(), path = `requirements/${f.req}/images/${f.imageId}`
      const storage = createAssetStorage({ driver: 'local', uploadDir: uploadsDir })
      await storage.put(f.asset.url, f.bytes.subarray(0, 24), 'image/png')
      await expect(agent(f.pat.token, path)).rejects.toMatchObject({ statusCode: 422 })
      await storage.put(f.asset.url, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')
      await expect(agent(f.pat.token, path)).rejects.toMatchObject({ statusCode: 413 })
      await storage.put(f.asset.url, f.bytes, 'text/plain')
      await database(async db => {
        const original = await db.query.requirements.findFirst({ where: eq(requirements.id, f.req) })
        const foreignId = `req_${nanoid(12)}`
        await db.insert(requirements).values({ ...original!, id: foreignId, key: 'REQ-99999', projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId })
        await db.update(assets).set({ requirementId: foreignId }).where(eq(assets.id, f.asset.id))
      })
      await expect(agent(f.pat.token, path)).rejects.toMatchObject({ statusCode: 400 })
      // 隔离测试库中模拟已有外链，接口仅检查正文引用，不请求外网。
      await database(async db => {
        const record = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, f.req) })
        record!.contentJson.content[0]!.attrs!.src = 'https://external.invalid/secret.png'
        await db.update(requirementCollaborationDocuments).set({ contentJson: record!.contentJson }).where(eq(requirementCollaborationDocuments.requirementId, f.req))
      })
      await expect(agent(f.pat.token, path)).rejects.toMatchObject({ statusCode: 415 })
    })
    it('旧草稿沿 Yjs 历史原位升级一次，废弃旧锁/快照，保留历史版本与无副作用重试', async () => {
      const req = await createRequirement(), pat = await credential()
      const content = ensureBlockIds<RichTextDocument>({ type: 'doc', content: [table(), paragraph()] })
      for (const cell of content.content[0]!.content![0]!.content!) delete cell.attrs!.diffId
      const doc = prosemirrorJSONToYDoc(richTextProseMirrorSchema, content, 'default'); doc.getText('title').insert(0, req.title)
      try {
        const old = readCollaborationDocument(doc), vector = Y.decodeStateVector(Y.encodeStateVector(doc)), snapshotId = `snap_${nanoid(24)}`
        await database(async db => {
          await db.update(requirementRevisions).set({ contentJson: old.contentJson }).where(eq(requirementRevisions.requirementId, req.id))
          await db.insert(requirementCollaborationDocuments).values({ requirementId: req.id, schemaVersion: 2, state: Y.encodeStateAsUpdate(doc), ...old, editEpoch: 4 })
          await db.insert(agentSnapshots).values({ id: snapshotId, requirementId: req.id, userId: seedIds.currentUserId, ...old,
            schemaVersion: 2, signature: 'legacy', editEpoch: 4, expiresAt: new Date(Date.now() + 60_000) })
          await db.insert(requirementAgentLocks).values({ requirementId: req.id, snapshotId, userId: seedIds.currentUserId, tokenId: pat.id, expiresAt: new Date(Date.now() + 60_000) })
        })
        await expect(agent(pat.token, `requirements/${req.id}`)).rejects.toMatchObject({ statusCode: 503 })
        await database(async db => {
          const previous = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, req.id) })
          const revisions = await db.select().from(requirementRevisions)
          expect(await upgradeDocumentSchemas(db)).toBe(1)
          const upgraded = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, req.id) })
          expect(upgraded).toMatchObject({ schemaVersion: 3, editEpoch: 5, updatedAt: previous!.updatedAt, attributionSequence: previous!.attributionSequence })
          expect(sameRichTextContent(upgraded!.contentJson, old.contentJson)).toBe(true)
          expect(upgraded!.contentJson.content[0]!.content![0]!.content!.every(cell => Boolean(cell.attrs!.diffId))).toBe(true)
          const restored = new Y.Doc(); Y.applyUpdate(restored, upgraded!.state)
          try { for (const [client, clock] of vector) expect(Y.decodeStateVector(Y.encodeStateVector(restored)).get(client)).toBe(clock) }
          finally { restored.destroy() }
          expect(await db.select().from(requirementRevisions)).toEqual(revisions)
          expect(await db.select().from(requirementAgentLocks)).toHaveLength(0)
          expect(await upgradeDocumentSchemas(db)).toBe(0)
          expect(await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, req.id) })).toEqual(upgraded)
        })
        await expect(agent(pat.token, 'operations', { snapshotId, requestId: nanoid(24), changeNote: '旧快照', operations: [{ op: 'set_title', title: '不应写入' }] })).rejects.toMatchObject({ statusCode: 409 })
        const loaded = await agent(pat.token, `requirements/${req.id}`)
        expect(loaded.schemaVersion).toBe(3)
        await expect(apiFetch(`/api/requirements/${req.id}/revisions`, { method: 'POST', headers: { 'x-rb-document-schema': '2' }, body: { contentJson: loaded.contentJson } })).rejects.toMatchObject({ statusCode: 409 })
      } finally { doc.destroy() }
    })
    it('尚未初始化的旧文档只在第一次建共同草稿时补单元格 ID', async () => {
      const req = await createRequirement(), old = ensureBlockIds<RichTextDocument>({ type: 'doc', content: [table(), paragraph()] })
      for (const cell of old.content[0]!.content![0]!.content!) delete cell.attrs!.diffId
      const result = await apiFetch(`/api/requirements/${req.id}/collaboration`, { method: 'POST', body: { initial: { title: req.title, contentJson: old } } })
      expect(result).toMatchObject({ initialized: true, schemaVersion: 3 })
      const again = await apiFetch(`/api/requirements/${req.id}/collaboration`, { method: 'POST', body: {} })
      expect(again.state).toBe(result.state)
    })
  })
}
