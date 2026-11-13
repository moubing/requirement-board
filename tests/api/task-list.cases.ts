import { $fetch, url } from '@nuxt/test-utils/e2e'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import type { RichTextDocument } from '../../shared/editor/document'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
const content = (): RichTextDocument => ({ type: 'doc', content: [{ type: 'taskList', content: [
  { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '验收任务' }] }] },
] }] })
export function registerTaskListTests({ apiFetch, createRequirement }: { apiFetch: Api; createRequirement: (title?: string) => Promise<Record<string, any>> }) {
  describe('任务清单完整持久化', () => {
    it('网页拒绝非法属性与嵌套，失败不创建版本', async () => {
      const req = await createRequirement('任务清单校验')
      const invalid = [
        { type: 'taskList', content: [] },
        { type: 'taskList', content: [{ type: 'paragraph' }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
        { type: 'taskList', attrs: { checked: true }, content: content().content[0]!.content },
        ...['true', 1, null].map(checked => ({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph' }] }] })),
      ]
      for (const node of invalid) await expect(apiFetch(`/api/requirements/${req.id}/revisions`, { method: 'POST', body: {
        contentJson: { type: 'doc', content: [node] }, changeNote: '非法状态',
      } })).rejects.toMatchObject({ statusCode: 400 })
      expect(await apiFetch(`/api/requirements/${req.id}/revisions`)).toHaveLength(1)
    })
    it('真实 Skill 创建/读取/校验/写入，勾选沿 Yjs 历史持久化，正式版与模板保留状态', async () => {
      const pat = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '任务清单测试' } })
      const dir = await mkdtemp(join(tmpdir(), 'rb-task-list-cli-'))
      const cli = async (...args: string[]) => (await promisify(execFile)(process.execPath, [resolve('skills/requirement-board/scripts/rb.mjs'), ...args], {
        windowsHide: true, env: { ...process.env, CODEX_HOME: dir, RB_BASE_URL: new URL(url('/')).origin, RB_TOKEN: pat.token },
      })).stdout
      const initial = new Y.Doc(), current = new Y.Doc(), reopened = new Y.Doc()
      try {
        const createFile = join(dir, 'create.json'), snapshotFile = join(dir, 'snapshot.json'), editFile = join(dir, 'edit.json'), readPath = join(dir, 'read.json')
        await cli('new', '--create', '--out', createFile)
        const request = JSON.parse(await readFile(createFile, 'utf8'))
        await writeFile(createFile, JSON.stringify({ ...request, title: '任务清单验收', changeNote: '完整任务清单', contentJson: content() }))
        const created = JSON.parse(await cli('submit', '--file', createFile))
        const path = `/api/requirements/${created.requirementId}`
        const original = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
        Y.applyUpdate(initial, decodeCollaborationState(original.state))
        await cli('snapshot', created.requirementId, '--out', snapshotFile)
        await cli('new', '--snapshot', snapshotFile, '--out', editFile)
        const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8')), edit = JSON.parse(await readFile(editFile, 'utf8'))
        const list = structuredClone(snapshot.contentJson.content[0])
        list.content[0].attrs.checked = true
        await writeFile(editFile, JSON.stringify({ ...edit, changeNote: '完成验收', operations: [{ op: 'replace_block', targetDiffId: list.attrs.diffId, node: list }] }))
        await cli('validate', '--file', editFile)
        expect(JSON.parse(await cli('submit', '--file', editFile)).revision).toBeNull()
        await cli('read', created.requirementId, '--out', readPath)
        const read = JSON.parse(await readFile(readPath, 'utf8'))
        expect(read.modified).toBe(true)
        expect(read.contentJson.content[0]).toEqual(list)
        await cli('show', created.requirementId, '--version', 'v1', '--out', join(dir, 'v1.json'))
        const v1 = JSON.parse(await readFile(join(dir, 'v1.json'), 'utf8'))
        expect(v1.contentJson.content[0].content[0].attrs.checked).toBe(false)
        const latest = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
        Y.applyUpdate(current, decodeCollaborationState(latest.state))
        for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(initial))) {
          expect(Y.decodeStateVector(Y.encodeStateVector(current)).get(client)).toBeGreaterThanOrEqual(clock)
        }
        expect(readCollaborationDocument(current).contentJson.content[0]).toEqual(list)
        // 模拟不识别 taskList 的旧编辑器过滤节点后回写，必须在合并前拒绝。
        const stale = new Y.Doc()
        try {
          Y.applyUpdate(stale, decodeCollaborationState(latest.state))
          const vector = Y.encodeStateVector(stale)
          stale.getXmlFragment('default').delete(0, 1)
          const edit = { id: 'edit_old_task_client_12345678', clientId: stale.clientID, intent: 'edit', update: Buffer.from(Y.encodeStateAsUpdate(stale, vector)).toString('base64') }
          await expect(apiFetch(`${path}/edits`, { method: 'POST', headers: { 'x-rb-document-capabilities': '' }, body: {
            schemaVersion: 3, editEpoch: latest.editEpoch, edits: [edit],
          } })).rejects.toMatchObject({ statusCode: 409, data: { data: { code: 'DOCUMENT_SCHEMA_CHANGED' } } })
          await expect(apiFetch(`${path}/revisions`, { method: 'POST', body: {
            ...readCollaborationDocument(stale), schemaVersion: 3, schemaCapabilities: [], editEpoch: latest.editEpoch,
            collaborationUpdate: encodeCollaborationState(stale), changeNote: '旧页面覆盖',
          } })).rejects.toMatchObject({ statusCode: 409, data: { data: { code: 'DOCUMENT_SCHEMA_CHANGED' } } })
          const preserved = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
          expect(preserved.state).toEqual(latest.state)
        } finally { stale.destroy() }
        const saved = await apiFetch(`${path}/revisions`, { method: 'POST', body: {
          ...readCollaborationDocument(current), changeNote: '保存验收结果', collaborationUpdate: encodeCollaborationState(current), editEpoch: latest.editEpoch, clientSaveId: 'task_list_save_v2',
        } })
        const revision = await apiFetch(`/api/revisions/${saved.id}`)
        expect(revision.version).toBe(2); expect(revision.contentText).toBe('[x] 验收任务')
        expect(revision.contentJson.content[0]).toEqual(list)
        const loaded = await apiFetch(`${path}/collaboration`, { method: 'POST', body: {} })
        Y.applyUpdate(reopened, decodeCollaborationState(loaded.state))
        expect(readCollaborationDocument(reopened).contentJson).toEqual(revision.contentJson)
        const template = await apiFetch('/api/document-templates', { method: 'POST', body: { name: '验收模板', documentType: 'requirement', contentJson: revision.contentJson } })
        const copy = await apiFetch('/api/requirements', { method: 'POST', body: { title: '模板副本', templateId: template.id } })
        const copied = await apiFetch(`/api/requirements/${copy.id}`)
        expect(copied.currentRevision.contentJson.content[0].content[0].attrs.checked).toBe(true)
        expect(copied.currentRevision.contentJson.content[0].attrs.diffId).not.toBe(list.attrs.diffId)
        const schema = await $fetch<any>('/api/agent/v1/schema', { headers: { authorization: `Bearer ${pat.token}` } })
        expect(schema.capabilities).toContain('task_lists')
        expect(schema.nodes.taskItem.content).toBe('paragraph block*')
      } finally {
        initial.destroy(); current.destroy(); reopened.destroy()
        if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('rb-task-list-cli-')) throw new Error('Invalid task list test cleanup path')
        await rm(dir, { recursive: true })
      }
    }, 30_000)
  })
}
