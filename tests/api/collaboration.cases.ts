import { $fetch } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createCollaborationDocument, decodeCollaborationState, encodeCollaborationState, ensureCollaborationTrailingParagraph, readCollaborationDocument } from '../../shared/collaboration/document'
import { eq } from 'drizzle-orm'
import { createDatabase } from '../../server/db/client'
import { requirementCollaborationDocuments, requirementEditEvents, requirementRevisions } from '../../server/db/schema'
import { TEST_DATABASE_URL } from '../setup/db'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'

interface Harness {
  apiFetch: <T = unknown>(url: string, options?: Record<string, any>) => Promise<T>
  createRequirement: (title?: string) => Promise<Record<string, any>>
}

export function registerCollaborationTests({ apiFetch, createRequirement }: Harness) {
  async function fixture() {
    const requirement = await createRequirement('共同标题')
    const path = `/api/requirements/${requirement.id}`
    const initial = { title: '共同标题', contentJson: { type: 'doc', content: [
      { type: 'paragraph', attrs: { diffId: 'paragraph_collaborative' }, content: [{ type: 'text', text: '共同正文' }] },
    ] } }
    const loaded = await apiFetch<{ state: string; initialized: boolean }>(`${path}/collaboration`, { method: 'POST', body: { initial } })
    const copy = () => { const doc = new Y.Doc(); Y.applyUpdate(doc, decodeCollaborationState(loaded.state)); return doc }
    return { path, loaded, copy, initial }
  }

  describe('共同文档 API', () => {
    it('代码块名称在协作保存与历史读取后保留，原文不包含名称', async () => {
      const req = await createRequirement('代码块名称持久化')
      const path = `/api/requirements/${req.id}`
      const contentJson = { type: 'doc', content: [
        { type: 'codeBlock', attrs: { diffId: 'named_code', language: 'typescript', title: '初始.ts' }, content: [{ type: 'text', text: 'const count = 1' }] },
        { type: 'paragraph', attrs: { diffId: 'named_tail' } },
      ] }
      const loaded = await apiFetch<{ state: string }>(`${path}/collaboration`, { method: 'POST', body: { initial: { title: req.title, contentJson } } })
      const doc = new Y.Doc(), reopened = new Y.Doc()
      try {
        Y.applyUpdate(doc, decodeCollaborationState(loaded.state))
        const block = doc.getXmlFragment('default').get(0) as Y.XmlElement
        block.setAttribute('title', '服务端保存.ts')
        const saved = await apiFetch<Record<string, any>>(`${path}/revisions`, { method: 'POST', body: {
          ...readCollaborationDocument(doc), changeNote: '', collaborationUpdate: encodeCollaborationState(doc), clientSaveId: 'named_code_revision_save',
        } })
        const history = await apiFetch<Record<string, any>>(`/api/revisions/${saved.id}`)
        expect(history.contentJson.content[0].attrs).toMatchObject({ title: '服务端保存.ts', language: 'typescript', diffId: 'named_code' })
        expect(history.contentText).toBe('const count = 1')
        const stored = await apiFetch<{ state: string }>(`${path}/collaboration`, { method: 'POST', body: {} })
        Y.applyUpdate(reopened, decodeCollaborationState(stored.state))
        expect(readCollaborationDocument(reopened).contentJson).toEqual(saved.contentJson)
        expect(readCollaborationDocument(reopened).contentJson.content[0]!.attrs!.title).toBe('服务端保存.ts')
      } finally { doc.destroy(); reopened.destroy() }
    })

    it.each([false, true])('读取已有旧文档不修复或隐藏尾段差异（已补空段：%s）', async hasTrailing => {
      const req = await createRequirement('旧版非段落结尾')
      const doc = createCollaborationDocument({ title: req.title, contentJson: { type: 'doc', content: [
        { type: 'codeBlock', attrs: { diffId: 'legacy_code' }, content: [{ type: 'text', text: 'const original = 1' }] },
      ] } })
      const { db, client } = createDatabase(TEST_DATABASE_URL)
      const old = readCollaborationDocument(doc)
      if (hasTrailing) ensureCollaborationTrailingParagraph(doc)
      const current = readCollaborationDocument(doc)
      const state = Y.encodeStateAsUpdate(doc)
      try {
        // 仅隔离测试库的历史夹具，模拟旧版本缺尾段，正文尚未补段或此前已自动补段。
        await db.update(requirementRevisions).set({ ...old, contentText: 'const original = 1' }).where(eq(requirementRevisions.requirementId, req.id))
        await db.insert(requirementCollaborationDocuments).values({ requirementId: req.id, ...current, state, editEpoch: 3 })
        const load = () => apiFetch<Record<string, any>>(`/api/requirements/${req.id}/collaboration`, { method: 'POST', body: {} })
        const [a, b] = await Promise.all([load(), load()])
        expect(a.state).toBe(b.state)
        expect(a.state).toBe(encodeCollaborationState(doc))
        const restored = new Y.Doc()
        try {
          Y.applyUpdate(restored, decodeCollaborationState(a.state))
          const normalized = readCollaborationDocument(restored)
          expect(normalized).toEqual(current)
          expect(sameRichTextContent(old.contentJson, normalized.contentJson)).toBe(!hasTrailing)
          expect(buildRichTextDiff(old.contentJson, normalized.contentJson).counts).toMatchObject({ inserted: hasTrailing ? 1 : 0, modified: 0, deleted: 0 })
          for (const [id, clock] of Y.decodeStateVector(Y.encodeStateVector(doc))) {
            expect(Y.decodeStateVector(Y.encodeStateVector(restored)).get(id)).toBe(clock)
          }
          expect((await load()).state).toBe(a.state)
          expect(a.editEpoch).toBe(3)
          expect(a.attributionSequence).toBe(0)
          expect(await db.select().from(requirementEditEvents).where(eq(requirementEditEvents.requirementId, req.id))).toHaveLength(0)
          const revisions = await db.select().from(requirementRevisions).where(eq(requirementRevisions.requirementId, req.id))
          expect(revisions).toHaveLength(1)
          expect(revisions[0]!.contentJson).toEqual(old.contentJson)
        } finally { restored.destroy() }
      } finally { doc.destroy(); await client.end() }
    })

    it('JSON 版本保存先补尾段，相同原请求重试不重复建版', async () => {
      const req = await createRequirement('接口版本尾段')
      const body = { contentJson: { type: 'doc', content: [{ type: 'codeBlock', attrs: { diffId: 'saved_code' }, content: [{ type: 'text', text: 'code' }] }] },
        changeNote: '正文规范化', clientSaveId: 'trailing_paragraph_revision_retry' }
      const first = await apiFetch<Record<string, any>>(`/api/requirements/${req.id}/revisions`, { method: 'POST', body })
      const retried = await apiFetch<Record<string, any>>(`/api/requirements/${req.id}/revisions`, { method: 'POST', body })
      expect(retried.id).toBe(first.id)
      expect(first.contentJson.content.map((node: any) => node.type)).toEqual(['codeBlock', 'paragraph'])
      expect(await apiFetch(`/api/requirements/${req.id}/revisions`)).toHaveLength(2)
    })

    it('只初始化一次，重复打开不覆盖共同正文，未登录不能获取协作状态', async () => {
      const f = await fixture()
      expect(f.loaded.initialized).toBe(true)
      const reopened = await apiFetch<{ state: string; initialized: boolean }>(`${f.path}/collaboration`, {
        method: 'POST', body: { initial: { ...f.initial, title: '迟到的独立草稿' } },
      })
      expect(reopened.initialized).toBe(false)
      expect(reopened.state).toBe(f.loaded.state)
      await expect($fetch(`${f.path}/collaboration`, { method: 'POST', body: {} })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('旧客户端保存时先合并共同文档，历史快照包含双方修改，重试不重复建版本', async () => {
      const f = await fixture()
      const a = f.copy(), b = f.copy()
      try {
        const left = (a.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
        const right = (b.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
        left.insert(0, '甲的输入')
        right.insert(right.length, '乙的输入')
        const body = (doc: Y.Doc, clientSaveId: string) => ({ ...readCollaborationDocument(doc), changeNote: '共同文档快照',
          collaborationUpdate: encodeCollaborationState(doc), clientSaveId })
        const firstBody = body(a, 'collaboration_save_first')
        const first = await apiFetch<Record<string, any>>(`${f.path}/revisions`, { method: 'POST', body: firstBody })
        const second = await apiFetch<Record<string, any>>(`${f.path}/revisions`, { method: 'POST', body: body(b, 'collaboration_save_second') })
        expect(first.version).toBe(2)
        expect(second.version).toBe(3)
        expect(second.contentText).toContain('甲的输入')
        expect(second.contentText).toContain('乙的输入')
        expect((await apiFetch<Record<string, any>>(`${f.path}/revisions`, { method: 'POST', body: firstBody })).id).toBe(first.id)
        expect(await apiFetch(`${f.path}/revisions`)).toHaveLength(3)
        const stored = await apiFetch<{ state: string }>(`${f.path}/collaboration`, { method: 'POST', body: {} })
        const reopened = new Y.Doc()
        try {
          Y.applyUpdate(reopened, decodeCollaborationState(stored.state))
          expect(readCollaborationDocument(reopened).contentJson).toEqual(second.contentJson)
        } finally { reopened.destroy() }
      } finally { a.destroy(); b.destroy() }
    })

    it('两人同时保存版本时，最后一个版本包含双方已提交的编辑', async () => {
      const f = await fixture()
      const a = f.copy(), b = f.copy()
      try {
        const left = (a.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
        const right = (b.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
        left.insert(0, '同时保存甲')
        right.insert(right.length, '同时保存乙')
        const saved = await Promise.all([a, b].map((doc, index) => apiFetch<Record<string, any>>(`${f.path}/revisions`, {
          method: 'POST', body: { ...readCollaborationDocument(doc), changeNote: '',
            collaborationUpdate: encodeCollaborationState(doc), clientSaveId: `collaboration_parallel_${index}` },
        })))
        expect(saved.map(row => row.version).sort()).toEqual([2, 3])
        const latest = saved.find(row => row.version === 3)!
        expect(latest.contentText).toContain('同时保存甲')
        expect(latest.contentText).toContain('同时保存乙')
      } finally { a.destroy(); b.destroy() }
    })

    it('拒绝非法协作内容，保留原共同文档和历史版本', async () => {
      const f = await fixture()
      const invalid = f.copy()
      try {
        ;(invalid.getXmlFragment('default').get(0) as Y.XmlElement).setAttribute('diffId', '')
        await expect(apiFetch(`${f.path}/revisions`, { method: 'POST', body: {
          ...f.initial, changeNote: '', collaborationUpdate: encodeCollaborationState(invalid), clientSaveId: 'collaboration_invalid_save',
        } })).rejects.toMatchObject({ statusCode: 400 })
        expect(await apiFetch(`${f.path}/revisions`)).toHaveLength(1)
        const stored = await apiFetch<{ state: string }>(`${f.path}/collaboration`, { method: 'POST', body: {} })
        expect(stored.state).toBe(f.loaded.state)
      } finally { invalid.destroy() }
    })
  })
}
