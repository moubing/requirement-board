import { $fetch } from '@nuxt/test-utils/e2e'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
const details = () => ({ type: 'details', content: [
  { type: 'detailsSummary', content: [{ type: 'text', text: '补充说明' }] },
  { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠正文' }] }] },
] })

export function registerDetailsTests({ apiFetch, createRequirement }: { apiFetch: Api; createRequirement: (title?: string) => Promise<Record<string, any>> }) {
  describe('折叠块完整持久化', () => {
    it('网页拒绝视图属性与非法结构，失败不产生版本', async () => {
      const req = await createRequirement('折叠块校验')
      for (const node of [
        { ...details(), attrs: { open: true } }, { ...details(), attrs: { hidden: 'until-found' } },
        { ...details(), content: [] }, { ...details(), content: [...details().content].reverse() },
        { ...details(), content: [details().content[0], { type: 'detailsContent' }] },
        { ...details(), content: [{ type: 'detailsSummary', content: [{ type: 'paragraph' }] }, details().content[1]] },
      ]) await expect(apiFetch(`/api/requirements/${req.id}/revisions`, { method: 'POST', body: {
        contentJson: { type: 'doc', content: [node] }, changeNote: '非法折叠块',
      } })).rejects.toMatchObject({ statusCode: 400 })
      expect(await apiFetch(`/api/requirements/${req.id}/revisions`)).toHaveLength(1)
    })
    it('Agent 创建和替换沿 Yjs 历史保存；旧页面被拒绝，正式版与模板内容完整', async () => {
      const pat = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '折叠块测试' } })
      const agent = (path: string, body?: any) => $fetch<any>(`/api/agent/v1/${path}`, {
        headers: { authorization: `Bearer ${pat.token}` }, ...(body ? { method: 'POST' as const, body } : {}),
      })
      const schema = await agent('schema')
      expect(schema.capabilities).toContain('details')
      expect(schema.nodes.details.attrs).not.toHaveProperty('open')
      await expect(agent('operations', { action: 'create', requestId: nanoid(24), title: '非法状态', changeNote: '校验',
        contentJson: { type: 'doc', content: [{ ...details(), attrs: { open: true } }] },
      })).rejects.toMatchObject({ statusCode: 422 })
      const created = await agent('operations', { action: 'create', requestId: nanoid(24), title: '折叠块验收', changeNote: '完整内容',
        contentJson: { type: 'doc', content: [details()] },
      })
      const path = `/api/requirements/${created.requirementId}`
      const loaded = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
      const initial = new Y.Doc(), current = new Y.Doc()
      try {
        Y.applyUpdate(initial, decodeCollaborationState(loaded.state))
        const snapshot = await agent(`requirements/${created.requirementId}/snapshot`, {})
        const block = structuredClone(snapshot.contentJson.content[0])
        block.content[1].content[0].content[0].text += '更新'
        const updated = await agent('operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '补充隐藏正文',
          operations: [{ op: 'replace_block', targetDiffId: block.attrs.diffId, node: block }],
        })
        expect(updated.revision).toBeNull()
        expect(updated.document.contentJson.content[0]).toEqual(block)
        const latest = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
        Y.applyUpdate(current, decodeCollaborationState(latest.state))
        for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(initial))) {
          expect(Y.decodeStateVector(Y.encodeStateVector(current)).get(client)).toBeGreaterThanOrEqual(clock)
        }
        const stale = new Y.Doc()
        try {
          Y.applyUpdate(stale, decodeCollaborationState(latest.state))
          const vector = Y.encodeStateVector(stale)
          stale.getXmlFragment('default').delete(0, 1)
          await expect(apiFetch(`${path}/edits`, { method: 'POST', headers: { 'x-rb-document-capabilities': 'task_lists' }, body: {
            schemaVersion: 3, editEpoch: latest.editEpoch,
            edits: [{ id: `edit_${nanoid(24)}`, clientId: stale.clientID, intent: 'edit', update: Buffer.from(Y.encodeStateAsUpdate(stale, vector)).toString('base64') }],
          } })).rejects.toMatchObject({ statusCode: 409 })
          expect((await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })).state).toBe(latest.state)
        } finally { stale.destroy() }
        expect((await apiFetch(`${path}`)).currentRevision.contentJson).toEqual(created.document.contentJson)
        const saved = await apiFetch(`${path}/revisions`, { method: 'POST', body: {
          ...readCollaborationDocument(current), collaborationUpdate: encodeCollaborationState(current), editEpoch: latest.editEpoch,
          clientSaveId: nanoid(24), changeNote: '保存折叠块',
        } })
        const revision = await apiFetch(`/api/revisions/${saved.id}`)
        expect(revision.contentText).toBe('补充说明\n折叠正文更新')
        expect(revision.contentJson.content[0]).toEqual(block)
        const template = await apiFetch('/api/document-templates', { method: 'POST', body: { name: '折叠模板', documentType: 'requirement', contentJson: revision.contentJson } })
        const copy = await apiFetch('/api/requirements', { method: 'POST', body: { title: '模板副本', templateId: template.id } })
        const copied = (await apiFetch(`/api/requirements/${copy.id}`)).currentRevision
        expect(copied.contentText).toBe(revision.contentText)
        expect(copied.contentJson.content[0].attrs.diffId).not.toBe(block.attrs.diffId)
        expect(copied.contentJson.content[0].content[0].attrs.diffId).not.toBe(block.content[0].attrs.diffId)
      } finally { initial.destroy(); current.destroy() }
    })
  })
}
