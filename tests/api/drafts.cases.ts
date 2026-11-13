import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { assets, requirementDrafts, requirementRevisions } from '../../server/db/schema'
import { garbageCollectAssets } from '../../server/services/asset-gc'
import { createAssetStorage } from '../../server/services/asset-storage'
import { TEST_ADMIN_PASSWORD, TEST_DATABASE_URL } from '../setup/db'
import type { DraftSnapshot, StoredDraft } from '../../shared/drafts/document'

interface Harness {
  apiFetch: <T = unknown>(url: string, options?: Record<string, any>) => Promise<T>
  createRequirement: (title?: string) => Promise<Record<string, any>>
  readSessionCookie: (response: Response) => string
  uploadsDir: string
}

export function registerDraftTests({ apiFetch, createRequirement, readSessionCookie, uploadsDir }: Harness) {
  async function fixture() {
    const requirement = await createRequirement('原始标题')
    const detail = await apiFetch<Record<string, any>>(`/api/requirements/${requirement.id}`)
    const snapshot: DraftSnapshot = { baseRevisionId: detail.currentRevision.id, title: '草稿标题', changeNote: '未完成说明', pendingUploads: [],
      contentJson: { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'draft_body' }, content: [{ type: 'text', text: '草稿正文' }] }] } }
    const path = `/api/requirements/${requirement.id}/drafts`
    const put = (id: string, expectedVersion: number, content = snapshot, mutationId = `mutation_${id}_${expectedVersion}`) =>
      apiFetch<StoredDraft>(`${path}/${id}`, { method: 'PUT', body: { expectedVersion, mutationId, snapshot: content } })
    return { requirement, detail, snapshot, path, put }
  }
  async function upload(requirementId: string, draftId: string, uploadId: string, file = true) {
    const form = new FormData()
    if (file) form.append('file', new Blob([new Uint8Array([137, 80, 78])], { type: 'image/png' }), 'draft.png')
    return apiFetch<Record<string, any>>(`/api/assets/upload?requirementId=${requirementId}&draftId=${draftId}&uploadId=${uploadId}`, { method: 'POST', body: form })
  }
  const image = (url: string) => ({ type: 'image', attrs: { src: url, diffId: 'draft_image', align: 'center' }, content: [{ type: 'imageCaption' }] })
  async function gc(now = new Date(), graceMs = 0) {
    const { client, db } = createDatabase(TEST_DATABASE_URL)
    try { return await garbageCollectAssets(db, { storage: createAssetStorage({ driver: 'local', uploadDir: uploadsDir }), now, graceMs }) }
    finally { await client.end() }
  }

  describe('个人草稿 API', () => {
    it('完整保存草稿，允许暂时为空的标题，不生成版本或修改正式标题', async () => {
      const f = await fixture()
      const saved = await f.put('draft_roundtrip', 0, { ...f.snapshot, title: '' })
      expect(saved.version).toBe(1)
      const list = await apiFetch<{ drafts: StoredDraft[] }>(f.path)
      expect(list.drafts).toHaveLength(1)
      expect(list.drafts[0]!.contentJson).toEqual(f.snapshot.contentJson)
      const detail = await apiFetch<Record<string, any>>(`/api/requirements/${f.requirement.id}`)
      expect(detail.title).toBe('原始标题')
      expect(detail.currentRevision.version).toBe(1)
      await expect(f.put('draft_invalid_json', 0, { ...f.snapshot, contentJson: { type: 'doc', content: [{ type: 'unknown' }] } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(f.put('draft_missing_ids', 0, { ...f.snapshot, contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(f.put('draft_duplicate_ids', 0, { ...f.snapshot, contentJson: { type: 'doc', content: [f.snapshot.contentJson.content[0]!, f.snapshot.contentJson.content[0]!] } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(f.put('draft_preview_url', 0, { ...f.snapshot, contentJson: { type: 'doc', content: [image('blob:temporary-image')] } })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('按完整快照更新，不用旧更新编号拦截保存，重试仍然幂等', async () => {
      const f = await fixture()
      const first = await f.put('draft_snapshot_updates', 0)
      expect((await f.put(first.id, 0)).version).toBe(1)
      expect((await f.put(first.id, 1, { ...f.snapshot, title: '第一次修改' }, 'mutation_first_edit')).version).toBe(2)
      const updated = await f.put(first.id, 1, { ...f.snapshot, title: '第二次修改' }, 'mutation_second_edit')
      expect(updated.version).toBe(3)
      expect((await apiFetch<{ drafts: StoredDraft[] }>(f.path)).drafts[0]!.title).toBe('第二次修改')
      await apiFetch(`${f.path}/${first.id}`, { method: 'DELETE', body: { expectedVersion: 1 } })
      await expect(f.put(first.id, 0)).rejects.toMatchObject({ statusCode: 410 })
      expect(await apiFetch(f.path)).toMatchObject({ drafts: [], closedIds: [first.id] })
    })

    it('草稿按本人隔离，管理员也不能读写其他人的个人草稿', async () => {
      const f = await fixture()
      const saved = await f.put('draft_private_user', 0)
      await expect($fetch(f.path)).rejects.toMatchObject({ statusCode: 401 })
      const login = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }) })
      const headers = { cookie: readSessionCookie(login) }
      expect(await $fetch(f.path, { headers })).toMatchObject({ drafts: [] })
      await expect($fetch(`${f.path}/${saved.id}`, { headers, method: 'PUT', body: {
        expectedVersion: saved.version, mutationId: 'mutation_other_user', snapshot: f.snapshot,
      } })).rejects.toMatchObject({ statusCode: 404 })
      await expect($fetch(`${f.path}/${saved.id}`, { headers, method: 'DELETE', body: { expectedVersion: saved.version } })).rejects.toMatchObject({ statusCode: 404 })
      const other = await createRequirement('另一个需求')
      await expect(apiFetch(`/api/requirements/${other.id}/drafts/draft_bad_base`, { method: 'PUT', body: {
        expectedVersion: 0, mutationId: 'mutation_bad_base', snapshot: f.snapshot,
      } })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('图片任务可幂等领取，草稿 JSON 尚未同步时 GC 仍保护图片', async () => {
      const f = await fixture()
      const saved = await f.put('draft_pending_image', 0)
      const results = await Promise.all([upload(f.requirement.id, saved.id, 'upload_pending_image'), upload(f.requirement.id, saved.id, 'upload_pending_image')])
      expect(results[0]!.id).toBe(results[1]!.id)
      expect((await upload(f.requirement.id, saved.id, 'upload_pending_image', false)).id).toBe(results[0]!.id)
      const { client, db } = createDatabase(TEST_DATABASE_URL)
      try {
        expect(await db.select().from(assets)).toHaveLength(1)
        await db.update(assets).set({ createdAt: new Date('2000-01-01') })
      } finally { await client.end() }
      expect((await gc()).deleted).toEqual([])
      await apiFetch(`${f.path}/${saved.id}`, { method: 'DELETE', body: { expectedVersion: saved.version } })
      expect((await gc(new Date(), 7 * 86400_000)).deleted).toEqual([])
      expect((await gc(new Date(Date.now() + 8 * 86400_000), 7 * 86400_000)).deleted).toEqual([results[0]!.id])
    })

    it('其他草稿的 JSON 引用仍保护图片，最后一份草稿丢弃后才回收', async () => {
      const f = await fixture()
      const first = await f.put('draft_original_image', 0)
      const asset = await upload(f.requirement.id, first.id, 'upload_shared_image')
      const second = await f.put('draft_copied_image', 0, { ...f.snapshot, contentJson: { type: 'doc', content: [image(asset.url)] } })
      await apiFetch(`${f.path}/${first.id}`, { method: 'DELETE', body: { expectedVersion: first.version } })
      expect((await gc()).deleted).toEqual([])
      await apiFetch(`${f.path}/${second.id}`, { method: 'DELETE', body: { expectedVersion: second.version } })
      expect((await gc(new Date(Date.now() + 8 * 86400_000))).deleted).toEqual([asset.id])
    })

    it('恢复旧基准后可以直接保存新版本，历史保留且重试不重复生成版本', async () => {
      const f = await fixture()
      const saved = await f.put('draft_publish_once', 0)
      const parallel = await f.put('draft_parallel_edit', 0)
      const body = { title: f.snapshot.title, contentJson: f.snapshot.contentJson, changeNote: f.snapshot.changeNote,
        draftId: saved.id, clientSaveId: 'publish_idempotent_1' }
      const url = `/api/requirements/${f.requirement.id}/revisions`
      const published = await apiFetch<Record<string, any>>(url, { method: 'POST', body })
      expect((await apiFetch<Record<string, any>>(url, { method: 'POST', body })).id).toBe(published.id)
      expect(await apiFetch(url)).toHaveLength(2)
      await expect(f.put(saved.id, saved.version)).rejects.toMatchObject({ statusCode: 410 })
      const next = await apiFetch<Record<string, any>>(url, { method: 'POST', body: {
        ...body, title: '旧草稿继续编辑后的标题', draftId: parallel.id, clientSaveId: 'publish_stale_base',
      } })
      expect(next.version).toBe(3)
      expect(next.title).toBe('原始标题')
      const revisions = await apiFetch<Record<string, any>[]>(`${url}?includeContent=true`)
      expect(revisions).toHaveLength(3)
      expect(revisions.find(revision => revision.id === published.id)?.contentJson).toEqual(f.snapshot.contentJson)
      expect((await apiFetch<Record<string, any>>(url, { method: 'POST', body })).id).toBe(published.id)
      expect((await apiFetch<{ drafts: StoredDraft[] }>(f.path)).drafts).toEqual([])
    })

    it('图片尚未上传完成时，不关闭草稿或生成版本', async () => {
      const f = await fixture()
      const saved = await f.put('draft_missing_image', 0, { ...f.snapshot, pendingUploads: [{ id: 'upload_not_ready', imageDiffId: 'img_pending', fileName: 'pending.png', mimeType: 'image/png', size: 3, position: 1, order: 1 }] })
      await expect(apiFetch(`/api/requirements/${f.requirement.id}/revisions`, { method: 'POST', body: {
        title: f.snapshot.title, contentJson: f.snapshot.contentJson, changeNote: f.snapshot.changeNote,
        draftId: saved.id, clientSaveId: 'publish_not_ready',
      } })).rejects.toMatchObject({ statusCode: 400 })
      const { client, db } = createDatabase(TEST_DATABASE_URL)
      try {
        expect(await db.select().from(requirementRevisions).where(eq(requirementRevisions.requirementId, f.requirement.id))).toHaveLength(1)
        expect((await db.select().from(requirementDrafts).where(and(eq(requirementDrafts.id, saved.id))))[0]!.closedAt).toBeNull()
      } finally { await client.end() }
    })
  })
}
