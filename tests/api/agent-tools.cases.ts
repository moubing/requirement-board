import { $fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { agentAssetUploads, assets, requirementAgentLocks, requirementRevisions, requirements } from '../../server/db/schema'
import { garbageCollectAssets } from '../../server/services/asset-gc'
import { createAssetStorage } from '../../server/services/asset-storage'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerAgentToolsTests({ apiFetch, uploadsDir }: { apiFetch: Api; uploadsDir: string }) {
  const credential = () => apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '文档工具验证' } })
  const agent = (token: string, path: string, body?: unknown) => $fetch<any>(`/api/agent/v1/${path}`, {
    headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { method: 'POST' as const, body }),
  })
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64')
  function form(bytes = png) {
    const value = new FormData()
    value.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), '聊天截图.png')
    return value
  }
  const creation = (nodes = [paragraph('图片限制 2 MB。')]) => ({ action: 'create', requestId: nanoid(24), title: '图片需求', changeNote: '建立图片需求', contentJson: { type: 'doc', content: nodes } })
  async function fixture() {
    const pat = await credential()
    const result = await agent(pat.token, 'operations', creation())
    return { token: pat.token, req: result.requirementId, revision: result.revision, pat }
  }
  async function edit(token: string, req: string, operations: (snapshot: any) => unknown[], save = false, properties?: unknown) {
    const snapshot = await agent(token, `requirements/${req}/snapshot`, {})
    return agent(token, 'operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '调整图片说明', operations: operations(snapshot),
      ...(save ? { saveRevision: { changeNote: '调整图片限制和示例' } } : {}), ...(properties ? { properties } : {}) })
  }
  describe('Agent 图片、条件读取和 Git 式查询', () => {
    it('版本列表只返回摘要，按版本读取才返回完整正文', async () => {
      const f = await fixture()
      const summaries = await agent(f.token, `requirements/${f.req}/revisions`)
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).not.toHaveProperty('contentJson')
      expect(summaries[0]).not.toHaveProperty('contentText')
      expect(summaries[0]).not.toHaveProperty('attribution')
      expect(Object.keys(summaries[0].author).sort()).toEqual(['id', 'name'])
      const revision = await agent(f.token, `revisions/${summaries[0].id}`)
      const shown = await agent(f.token, `requirements/${f.req}/show?version=v1`)
      expect(shown.contentJson).toEqual(revision.contentJson)
      expect(revision.contentJson.content[0].content[0].text).toBe('图片限制 2 MB。')
    })

    it('条件读取省略正文，属性及版本元数据仍更新，编辑快照沿用同一内容标识', async () => {
      const f = await fixture()
      const read = await agent(f.token, `requirements/${f.req}`)
      expect(read.contentToken).toMatch(/^3:[a-f0-9]{64}$/)
      expect(read.latestRevision).not.toHaveProperty('contentJson')
      const conditional = `?ifContentToken=${read.contentToken}`
      const unchanged = await agent(f.token, `requirements/${f.req}${conditional}`)
      expect(unchanged).toMatchObject({ notModified: true, modified: false })
      expect(unchanged).not.toHaveProperty('contentJson')
      await apiFetch(`/api/requirements/${f.req}`, { method: 'PATCH', body: { priority: 'high' } })
      expect(await agent(f.token, `requirements/${f.req}/status${conditional}`)).toMatchObject({ notModified: true, modified: false, properties: { priority: 'high' } })
      const snapshot = await agent(f.token, `requirements/${f.req}/snapshot`, { ifContentToken: read.contentToken })
      expect(snapshot).toMatchObject({ notModified: true, contentToken: read.contentToken })
      expect(snapshot).not.toHaveProperty('contentJson')
      const saved = await agent(f.token, 'operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '保存', operations: [], saveRevision: { changeNote: '确认图片需求' } })
      expect(saved.document.contentJson).toEqual(read.contentJson)
      expect(await agent(f.token, `requirements/${f.req}${conditional}`)).toMatchObject({ notModified: true, latestRevision: { version: 2 } })
      await edit(f.token, f.req, () => [{ op: 'set_title', title: '图片新标题' }])
      const changed = await agent(f.token, `requirements/${f.req}${conditional}`)
      expect(changed).toMatchObject({ notModified: false, modified: false, title: '图片新标题' })
      expect(changed.contentToken).not.toBe(read.contentToken)
      expect(changed.contentJson).toBeDefined()
    })

    it('服务端结果包含最终分配的块 ID；后续快照可复用且失效凭证不能读取缓存状态', async () => {
      const f = await fixture()
      const edited = await edit(f.token, f.req, s => [{ op: 'insert_blocks', anchorDiffId: s.contentJson.content[0].attrs.diffId, position: 'after', nodes: [paragraph('新增的图片说明')] }])
      const read = await agent(f.token, `requirements/${f.req}`)
      expect(edited.document.contentToken).toBe(read.contentToken)
      expect(edited.document.contentJson).toEqual(read.contentJson)
      expect(read.contentJson.content[1].attrs.diffId).toBeTruthy()
      expect((await agent(f.token, `requirements/${f.req}/snapshot`, { ifContentToken: edited.document.contentToken })).notModified).toBe(true)
      await apiFetch(`/api/account/agent-tokens/${f.pat.id}/revoke`, { method: 'POST' })
      await expect(agent(f.token, `requirements/${f.req}/status?ifContentToken=${read.contentToken}`)).rejects.toMatchObject({ statusCode: 401 })
    })

    it('持锁凭证可上传和插入图片，其他凭证被拒；重试不重复上传且不自动保存版本', async () => {
      const f = await fixture(), other = await credential()
      const snapshot = await agent(f.token, `requirements/${f.req}/snapshot`, {})
      const query = `assets/upload?requirementId=${f.req}&uploadId=${nanoid(24)}`
      await expect(agent(other.token, query, form())).rejects.toMatchObject({ statusCode: 423 })
      const uploaded = await agent(f.token, query, form())
      expect(await agent(f.token, query, form())).toEqual(uploaded)
      await expect(agent(f.token, query, form(Buffer.concat([png, Buffer.from('different')])))).rejects.toMatchObject({ statusCode: 409 })
      const result = await agent(f.token, 'operations', { snapshotId: snapshot.id, requestId: nanoid(24), changeNote: '插入截图',
        operations: [{ op: 'insert_blocks', anchorDiffId: snapshot.contentJson.content[0].attrs.diffId, position: 'after', nodes: [uploaded.node] }] })
      expect(result.revision).toBeNull()
      expect(result.document.contentJson.content[1].attrs.src).toBe(uploaded.url)
      expect(await database(db => db.select().from(assets))).toHaveLength(1)
      expect(await agent(f.token, `requirements/${f.req}/revisions`)).toHaveLength(1)
      const diff = await agent(f.token, `requirements/${f.req}/diff`)
      expect(diff.blocks[0].after.node.attrs.src).toBe(uploaded.url)
    })

    it('新建前暂存图片，校验不绑定；执行原子绑定完整 v1，幂等重试保留一个需求', async () => {
      const pat = await credential(), input = creation()
      const uploadPath = `assets/upload?createRequestId=${input.requestId}&uploadId=${nanoid(24)}`
      const uploaded = await agent(pat.token, uploadPath, form())
      input.contentJson.content.push(uploaded.node)
      expect((await agent(pat.token, 'operations/validate', input)).valid).toBe(true)
      expect((await database(db => db.query.assets.findFirst({ where: eq(assets.id, uploaded.id) })))?.requirementId).toBeNull()
      await expect(agent(pat.token, 'operations', { ...input, requestId: nanoid(24) })).rejects.toMatchObject({ statusCode: 400 })
      const result = await agent(pat.token, 'operations', input)
      expect((await database(db => db.query.assets.findFirst({ where: eq(assets.id, uploaded.id) })))?.requirementId).toBe(result.requirementId)
      expect(result.revision.version).toBe(1)
      expect(result.document.contentJson.content[1].attrs.src).toBe(uploaded.url)
      expect(await agent(pat.token, 'operations', input)).toEqual(result)
      expect(await agent(pat.token, uploadPath, form())).toEqual(uploaded)
      await expect(agent(pat.token, `assets/upload?createRequestId=${input.requestId}&uploadId=${nanoid(24)}`, form())).rejects.toMatchObject({ statusCode: 409 })
    })

    it('暂存图片校验用户、项目、请求和到期时间；过期未引用资源可清理，历史引用继续保护', async () => {
      const pat = await credential(), input = creation()
      const uploaded = await agent(pat.token, `assets/upload?createRequestId=${input.requestId}&uploadId=${nanoid(24)}`, form())
      input.contentJson.content.push(uploaded.node)
      await database(db => db.update(assets).set({ uploadedById: seedIds.frontendUserId }).where(eq(assets.id, uploaded.id)))
      await expect(agent(pat.token, 'operations/validate', input)).rejects.toMatchObject({ statusCode: 400 })
      await database(db => db.update(assets).set({ uploadedById: seedIds.currentUserId }).where(eq(assets.id, uploaded.id)))
      await database(db => db.update(agentAssetUploads).set({ projectId: seedIds.otherProjectId }).where(eq(agentAssetUploads.assetId, uploaded.id)))
      await expect(agent(pat.token, 'operations/validate', input)).rejects.toMatchObject({ statusCode: 400 })
      await database(db => db.update(agentAssetUploads).set({ projectId: seedIds.projectId, expiresAt: new Date(0) }).where(eq(agentAssetUploads.assetId, uploaded.id)))
      await expect(agent(pat.token, 'operations/validate', input)).rejects.toMatchObject({ statusCode: 400 })
      const orphan = await agent(pat.token, `assets/upload?createRequestId=${nanoid(24)}&uploadId=${nanoid(24)}`, form())
      const storage = createAssetStorage({ driver: 'local', uploadDir: uploadsDir })
      try {
        const gc = await database(db => garbageCollectAssets(db, { storage, graceMs: 0, dryRun: true }))
        expect(gc.candidates).toContain(uploaded.id)
        expect(gc.candidates).not.toContain(orphan.id)
        await database(db => db.update(agentAssetUploads).set({ expiresAt: new Date(Date.now() + 86400_000) }).where(eq(agentAssetUploads.assetId, uploaded.id)))
        const result = await agent(pat.token, 'operations', input)
        await edit(pat.token, result.requirementId, s => [{ op: 'delete_block', targetDiffId: s.contentJson.content[1].attrs.diffId }], true)
        await database(db => db.update(agentAssetUploads).set({ expiresAt: new Date(0) }))
        const later = await database(db => garbageCollectAssets(db, { storage, graceMs: 0, dryRun: true }))
        expect(later.candidates).not.toContain(uploaded.id)
        expect(later.candidates).toContain(orphan.id)
      } finally { storage.close() }
    })

    it('拒绝伪装图片、超限文件、缺少 PAT 以及其他项目资源', async () => {
      const f = await fixture(), path = `assets/upload?requirementId=${f.req}&uploadId=${nanoid(24)}`
      await expect(agent(f.token, path, form(Buffer.from('<svg>not a bitmap</svg>')))).rejects.toMatchObject({ statusCode: 415 })
      await expect(agent(f.token, path, form(Buffer.alloc(5 * 1024 * 1024 + 1)))).rejects.toMatchObject({ statusCode: 413 })
      await expect($fetch('/api/agent/v1/' + path, { method: 'POST', body: form() })).rejects.toMatchObject({ statusCode: 401 })
      const foreignId = 'req_other_asset_authorization'
      await database(async db => {
        const original = await db.query.requirements.findFirst({ where: eq(requirements.id, f.req) })
        await db.insert(requirements).values({ ...original!, id: foreignId, key: 'REQ-99999', projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId })
      })
      for (const suffix of ['/status', '/diff', '/show?version=v1', '/history?text=图片']) await expect(agent(f.token, `requirements/${foreignId}${suffix}`)).rejects.toMatchObject({ statusCode: 404 })
      await expect(agent(f.token, `assets/upload?requirementId=${foreignId}&uploadId=${nanoid(24)}`, form())).rejects.toMatchObject({ statusCode: 404 })
      expect(await database(db => db.select().from(assets))).toHaveLength(0)
    })

    it('默认比较草稿，历史比较不混入新编辑；分页绑定内容，stat 省略正文', async () => {
      const f = await fixture()
      await edit(f.token, f.req, s => [{ op: 'set_title', title: '图片上限' }, { op: 'replace_block', targetDiffId: s.contentJson.content[0].attrs.diffId,
        node: { ...s.contentJson.content[0], content: [{ type: 'text', text: '图片限制 5 MB。' }] } },
      { op: 'insert_blocks', anchorDiffId: s.contentJson.content[0].attrs.diffId, position: 'after', nodes: [paragraph('增加示例')] }])
      const first = await agent(f.token, `requirements/${f.req}/diff?limit=1`)
      expect(first).toMatchObject({ base: { version: 1 }, target: { id: 'draft' }, title: { changed: true }, total: 2, nextOffset: 1 })
      expect(first.blocks[0].before.text).toBe('图片限制 2 MB。')
      const next = `offset=1&comparisonToken=${first.comparisonToken}`
      expect((await agent(f.token, `requirements/${f.req}/diff?${next}`)).blocks[0].after.text).toBe('增加示例')
      const stat = await agent(f.token, `requirements/${f.req}/diff?stat=true`)
      expect(stat.blocks).toEqual([]); expect(stat.total).toBe(2)
      await edit(f.token, f.req, () => [], true)
      expect((await agent(f.token, `requirements/${f.req}/diff`)).total).toBe(0)
      await expect(agent(f.token, `requirements/${f.req}/diff?${next}`)).rejects.toMatchObject({ statusCode: 409 })
      const historical = await agent(f.token, `requirements/${f.req}/diff?from=v1&to=v2`)
      expect(historical.total).toBe(2)
      expect((await agent(f.token, `requirements/${f.req}/show?version=v1`)).title).toBe('图片需求')
      expect(await agent(f.token, `requirements/${f.req}/revisions`)).toHaveLength(2)
      expect(await database(db => db.select().from(requirementAgentLocks))).toHaveLength(0)
      const other = await fixture()
      await expect(agent(f.token, `requirements/${f.req}/diff?to=${other.revision.id}`)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('文本历史沿相邻版本投影，保存人和节点参与者分开，支持重复文本及 Unicode 定位', async () => {
      const f = await fixture()
      const second = await edit(f.token, f.req, s => [{ op: 'replace_block', targetDiffId: s.contentJson.content[0].attrs.diffId,
        node: { ...s.contentJson.content[0], content: [{ type: 'text', text: '图片限制 5 MB。' }] } }], true)
      // 保存人来自版本，参与者来自节点，不能用其中之一替代另一个。
      await database(db => db.update(requirementRevisions).set({ authorId: seedIds.designUserId }).where(eq(requirementRevisions.id, second.revision.id)))
      const history = await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent('图片限制 5 MB。')}`)
      expect(history.status).toBe('found')
      expect(history.entries.map((entry: any) => entry.version)).toEqual([2, 1])
      expect(history.entries[0].segments[0]).toMatchObject({ before: '图片限制 2 MB。', after: '图片限制 5 MB。', participants: [{ userId: seedIds.currentUserId }] })
      expect(history.entries[0].savedBy).not.toBe(history.entries[0].segments[0].participants[0].name)
      expect(history.entries[0]).toMatchObject({ status: 'modified', confidence: 'exact', comparedTo: { version: 1 } })
      expect(history.entries[1]).toMatchObject({ status: 'introduced', confidence: 'exact', comparedTo: null })
      expect(history.entries[1].explanation).toContain('最早可用版本')
      expect(history.entries[1].segments[0].participantsUnknown).toBe(true)
      await edit(f.token, f.req, s => [{ op: 'insert_blocks', anchorDiffId: s.contentJson.content[0].attrs.diffId, position: 'after', nodes: [paragraph('😀图片限制 5 MB。图片限制 5 MB。')] }])
      const ambiguous = await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent('图片限制 5 MB。')}`)
      expect(ambiguous).toMatchObject({ status: 'ambiguous', matchCount: 3, entries: [] })
      const match = ambiguous.matches.find((m: any) => m.start === 1)
      expect((await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent('图片限制 5 MB。')}&block=${match.blockId}&start=1`)).status).toBe('found')
      expect((await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent('图片限制 2 MB。')}&at=v1`)).status).toBe('found')
      expect((await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent('不存在')}`)).status).toBe('not_found')
    })

    it('已找到文本但无法对应更早版本时，明确返回追溯中断而非首次出现', async () => {
      const f = await fixture()
      const text = '登录失败后展示错误提示。'
      await edit(f.token, f.req, s => [{ op: 'insert_blocks', anchorDiffId: s.contentJson.content[0].attrs.diffId,
        position: 'after', nodes: [paragraph(text)] }], true)
      const history = await agent(f.token, `requirements/${f.req}/history?text=${encodeURIComponent(text)}`)
      expect(history.status).toBe('found')
      expect(history.entries).toHaveLength(1)
      expect(history.entries[0]).toMatchObject({ version: 2, status: 'tracking_lost', confidence: 'lost',
        comparedTo: { revisionId: f.revision.id, version: 1 },
        segments: [{ status: 'tracking_lost', confidence: 'lost', before: '', after: text }],
      })
      expect(history.entries[0].explanation).toContain('不是查询失败')
      expect(history.entries[0].segments[0].explanation).toContain('不能据此确认首次出现')
      expect(history.truncated).toBe(false)
    })

    it('历史查询达到上限时明确标记边界，不把截断位置当成首次创作', async () => {
      const f = await fixture()
      const current = await agent(f.token, `requirements/${f.req}`)
      await database(db => db.insert(requirementRevisions).values(Array.from({ length: 201 }, (_, index) => ({
        id: `rev_${nanoid(12)}`, requirementId: f.req, version: index + 2, title: current.title, contentJson: current.contentJson,
        contentText: '图片限制 2 MB。', changeNote: '历史快照', authorId: seedIds.currentUserId,
      }))))
      const path = `requirements/${f.req}/history?text=${encodeURIComponent('图片限制 2 MB。')}`
      const history = await agent(f.token, path)
      expect(history).toMatchObject({ status: 'found', truncated: true, oldestExaminedVersion: 3 })
      expect(history.entries).toHaveLength(1)
      expect(history.entries[0]).toMatchObject({ version: 3, status: 'history_boundary', comparedTo: null, segments: [{ status: 'history_boundary' }] })
      expect(history.entries[0].explanation).toContain('版本上限')
      const older = await agent(f.token, path + '&at=v3')
      expect(older.truncated).toBe(false)
      expect(older.entries[0]).toMatchObject({ version: 1, status: 'introduced' })
      await expect(agent(f.token, `requirements/${f.req}/show?version=v999999999999999`)).rejects.toMatchObject({ statusCode: 400 })
    })
  })
}
