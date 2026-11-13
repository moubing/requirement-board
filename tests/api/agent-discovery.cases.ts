import { $fetch, url } from '@nuxt/test-utils/e2e'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../../server/db/client'
import { agentSnapshots, agentTokens, auditEvents, projectMembers, requirementAgentLocks, requirementAssignees,
  requirementCollaborationDocuments, requirementRelations, requirementRevisions, requirements, users } from '../../server/db/schema'
import { REQUIREMENT_SORT_KEYS, type RequirementPage } from '../../shared/requirements/query'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerAgentDiscoveryTests({ apiFetch }: { apiFetch: Api }) {
  const credential = () => apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '关联分页验收' } })
  const agent = (token: string, path: string, options: Record<string, any> = {}) => $fetch<any>(`/api/agent/v1/${path}`, {
    ...options, retry: 0, headers: { authorization: `Bearer ${token}` },
  })
  const related = (token: string, id: string) => agent(token, `requirements/${id}/related`)
  const add = (token: string, id: string, documentIds: string[]) => agent(token, `requirements/${id}/related`, { method: 'POST', body: { documentIds } })
  const remove = (token: string, id: string, target: string) => agent(token, `requirements/${id}/related/${target}`, { method: 'DELETE' })
  const create = (token: string, documentType = 'requirement') => agent(token, 'operations', { method: 'POST', body: {
    action: 'create', requestId: nanoid(24), title: `关联${documentType}`, documentType, changeNote: '建立完整初版',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '保留原始正文' }] }] },
  } })
  async function database<T>(work: (db: Database) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const protectedState = () => database(async db => ({
    revisions: await db.select().from(requirementRevisions).orderBy(requirementRevisions.id),
    documents: await db.select().from(requirementCollaborationDocuments).orderBy(requirementCollaborationDocuments.requirementId),
    audits: await db.select().from(auditEvents).orderBy(auditEvents.id),
    snapshots: await db.select().from(agentSnapshots).orderBy(agentSnapshots.id),
    locks: await db.select().from(requirementAgentLocks).orderBy(requirementAgentLocks.requirementId),
  }))
  const metadata = () => database(db => db.select().from(requirements).orderBy(requirements.id))

  describe('Agent 关联与分页', () => {
    it('四类文档任意交叉关联，增量和并发反向请求幂等；正文、Yjs、版本及日志隔离', async () => {
      const pat = await credential()
      const ids: string[] = []
      for (const type of ['requirement', 'defect', 'instruction', 'todo']) ids.push((await create(pat.token, type)).requirementId)
      const before = await protectedState()
      expect(await related(pat.token, ids[0]!)).toEqual([])
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        await Promise.all([add(pat.token, ids[i]!, [ids[j]!, ids[j]!]), add(pat.token, ids[j]!, [ids[i]!])])
      }
      expect(await database(db => db.select().from(requirementRelations))).toHaveLength(6)
      for (const id of ids) expect((await related(pat.token, id)).map((item: any) => item.id).sort()).toEqual(ids.filter(other => other !== id).sort())
      const timestamps = await metadata()
      await add(pat.token, ids[0]!, [ids[1]!])
      expect(await metadata()).toEqual(timestamps)
      await remove(pat.token, ids[1]!, ids[0]!)
      const removed = await metadata()
      await remove(pat.token, ids[0]!, ids[1]!)
      expect(await metadata()).toEqual(removed)
      expect((await related(pat.token, ids[0]!)).map((item: any) => item.id).sort()).toEqual(ids.slice(2).sort())
      expect(await protectedState()).toEqual(before)
      const target = (await metadata()).find(row => row.id === ids[2])!
      await apiFetch(`/api/requirements/${target.id}`, { method: 'PATCH', body: { title: '最新说明标题', statusId: 'test_status_published' } })
      expect(await related(pat.token, ids[0]!)).toEqual(expect.arrayContaining([expect.objectContaining({
        id: target.id, key: target.key, title: '最新说明标题', documentType: 'instruction',
        status: expect.objectContaining({ code: 'published' }), documentUrl: `/requirements/${target.id}`,
      })]))
    })

    it('输入上限在去重前校验，源和目标归属有效；任何失败均不留下部分关联或更新时间', async () => {
      const pat = await credential(), a = await create(pat.token), b = await create(pat.token)
      const foreign = await database(async db => (await db.insert(requirements).values({ id: 'req_foreign', key: 'REQ-800',
        projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId, reporterId: seedIds.outsiderUserId, title: '不可泄露标题' }).returning())[0]!)
      const before = await metadata()
      for (const body of [{ documentIds: [] }, { documentIds: [3] }, { documentIds: [a.requirementId] },
        { documentIds: Array(101).fill(b.requirementId) }, { documentIds: [b.requirementId], extra: true }]) {
        await expect(agent(pat.token, `requirements/${a.requirementId}/related`, { method: 'POST', body })).rejects.toMatchObject({ statusCode: 400 })
      }
      for (const target of ['req_missing', foreign.id, foreign.key]) {
        await expect(add(pat.token, a.requirementId, [b.requirementId, target])).rejects.toMatchObject({ statusCode: 404 })
        await expect(remove(pat.token, a.requirementId, target)).rejects.toMatchObject({ statusCode: 404 })
        await expect(related(pat.token, target)).rejects.toMatchObject({ statusCode: 404 })
        await expect(add(pat.token, target, [b.requirementId])).rejects.toMatchObject({ statusCode: 404 })
      }
      expect(await metadata()).toEqual(before)
      expect(await related(pat.token, a.requirementId)).toEqual([])
      const bRow = (await metadata()).find(row => row.id === b.requirementId)!
      expect(await add(pat.token, a.requirementId, Array(100).fill(bRow.key))).toMatchObject([{ id: b.requirementId }])
      await expect(remove(pat.token, bRow.key, b.requirementId)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('源或目标的有效锁包括同 PAT 均阻止整批写入，只读可用；提交解锁后关联', async () => {
      const pat = await credential(), a = await create(pat.token), b = await create(pat.token), c = await create(pat.token)
      await add(pat.token, a.requirementId, [b.requirementId])
      for (const id of [a.requirementId, b.requirementId]) {
        const snapshot = await agent(pat.token, `requirements/${id}/snapshot`, { method: 'POST', body: {} })
        const before = await metadata()
        await expect(add(pat.token, a.requirementId, [c.requirementId, b.requirementId])).rejects.toMatchObject({ statusCode: 423 })
        await expect(remove(pat.token, a.requirementId, b.requirementId)).rejects.toMatchObject({ statusCode: 423 })
        expect(await related(pat.token, a.requirementId)).toHaveLength(1)
        expect(await related(pat.token, c.requirementId)).toEqual([])
        expect(await metadata()).toEqual(before)
        const result = await agent(pat.token, 'operations', { method: 'POST', body: { snapshotId: snapshot.id, requestId: nanoid(24),
          changeNote: '修改后继续关联', operations: [{ op: 'set_title', title: '修改后标题' }] } })
        expect(result.revision).toBeNull()
      }
      await add(pat.token, a.requirementId, [c.requirementId])
      expect(await related(pat.token, a.requirementId)).toHaveLength(2)
      for (const id of [a.requirementId, b.requirementId, c.requirementId]) expect(await apiFetch(`/api/requirements/${id}/revisions`)).toHaveLength(1)
    })

    it('关系插入后的元信息失败回滚整个事务', async () => {
      const pat = await credential(), a = await create(pat.token), b = await create(pat.token)
      const before = await metadata()
      await database(async db => {
        await db.execute(sql`alter table requirements add constraint test_agent_relation_update_reject check (updated_at = created_at) not valid`)
        try { await expect(add(pat.token, a.requirementId, [b.requirementId])).rejects.toMatchObject({ statusCode: 500 }) }
        finally { await db.execute(sql`alter table requirements drop constraint test_agent_relation_update_reject`) }
      })
      expect(await related(pat.token, a.requirementId)).toEqual([])
      expect(await metadata()).toEqual(before)
    })

    it.each(['expired', 'revoked', 'banned', 'membership'])('关联及分页每次检查 PAT 和项目资格：%s', async condition => {
      const pat = await credential(), a = await create(pat.token), b = await create(pat.token)
      const calls = [
        [`requirements/${a.requirementId}/related`, {}],
        [`requirements/${a.requirementId}/related`, { method: 'POST', body: { documentIds: [b.requirementId] } }],
        [`requirements/${a.requirementId}/related/${b.requirementId}`, { method: 'DELETE' }],
        ['requirements?page=1', {}],
      ] as const
      for (const [path, options] of calls) await expect($fetch(`/api/agent/v1/${path}`, { ...options, retry: 0 })).rejects.toMatchObject({ statusCode: 401 })
      await database(async db => {
        if (condition === 'expired') await db.update(agentTokens).set({ expiresAt: new Date(0) }).where(eq(agentTokens.id, pat.id))
        if (condition === 'revoked') await db.update(agentTokens).set({ revokedAt: new Date() }).where(eq(agentTokens.id, pat.id))
        if (condition === 'banned') await db.update(users).set({ banned: true }).where(eq(users.id, seedIds.currentUserId))
        if (condition === 'membership') await db.delete(projectMembers).where(and(eq(projectMembers.userId, seedIds.currentUserId), eq(projectMembers.projectId, seedIds.projectId)))
      })
      for (const [path, options] of calls) await expect(agent(pat.token, path, options)).rejects.toMatchObject({ statusCode: ['expired', 'revoked'].includes(condition) ? 401 : 403 })
    })

    it('250 条查询遍历 13 页无重漏，组合筛选、所有排序与网页相同，旧数组形状兼容', async () => {
      const pat = await credential(), time = new Date('2026-11-01T00:00:00Z')
      await database(async db => {
        await db.insert(requirements).values(Array.from({ length: 250 }, (_, i) => ({ id: `req_page_${String(i + 1).padStart(3, '0')}`,
          key: `REQ-${i + 1}`, title: `付款 ＡＰＩ 100%_path\\file ${i + 1}`, documentType: i % 2 ? 'todo' as const : 'requirement' as const,
          projectId: seedIds.projectId, statusId: seedIds.backlogStatusId, reporterId: seedIds.currentUserId, createdAt: time, updatedAt: time })))
        await db.insert(requirements).values({ id: 'req_hidden', key: 'REQ-999', title: '付款', projectId: seedIds.otherProjectId,
          statusId: seedIds.otherStatusId, reporterId: seedIds.outsiderUserId })
        await db.insert(requirementAssignees).values([seedIds.currentUserId, seedIds.designUserId].map(userId => ({ requirementId: 'req_page_001', userId })))
      })
      const ids: string[] = []
      for (let number = 1; number <= 13; number++) {
        const found = await agent(pat.token, 'requirements', { query: { page: number, pageSize: 20 } }) as RequirementPage
        expect(found).toMatchObject({ page: number, pageSize: 20, total: 250 })
        expect(Number.isFinite(Date.parse(found.asOf))).toBe(true)
        expect(found.items).toHaveLength(number === 13 ? 10 : 20)
        ids.push(...found.items.map(item => item.id))
      }
      expect(ids).toEqual(Array.from({ length: 250 }, (_, i) => `req_page_${String(250 - i).padStart(3, '0')}`))
      expect(new Set(ids).size).toBe(250)
      expect(await agent(pat.token, 'requirements?page=14')).toMatchObject({ items: [], total: 250 })
      expect(await agent(pat.token, 'requirements', { query: { page: 1, q: '没有匹配' } })).toMatchObject({ items: [], total: 0 })
      const filters = { page: 1, q: '付款 api %_path\\file', documentType: 'requirement', statusId: seedIds.backlogStatusId, assignee: 'me' }
      expect(await agent(pat.token, 'requirements', { query: filters })).toMatchObject({ total: 1, items: [{ id: 'req_page_001', assigneeIds: expect.arrayContaining([seedIds.currentUserId, seedIds.designUserId]) }] })
      expect(await agent(pat.token, 'requirements', { query: { ...filters, assignee: seedIds.designUserId } })).toMatchObject({ total: 1 })
      expect(await agent(pat.token, 'requirements', { query: { ...filters, excludeId: 'req_page_001' } })).toMatchObject({ total: 0 })
      expect(await agent(pat.token, 'requirements', { query: { page: 1, assignee: 'unassigned' } })).toMatchObject({ total: 249 })
      for (const query of [{ page: 1, q: 'ＲＥＱ＿７' }, { page: 2, q: '付款 api' },
        ...REQUIREMENT_SORT_KEYS.flatMap(sortBy => ['asc', 'desc'].map(sortOrder => ({ page: 2, pageSize: 7, sortBy, sortOrder })))]) {
        const actual = await agent(pat.token, 'requirements', { query })
        const web = await apiFetch('/api/requirements', { query })
        expect(actual.items).toEqual(web.items)
        expect(actual.total).toBe(web.total)
      }
      const legacy = await agent(pat.token, 'requirements')
      expect(legacy).toHaveLength(100)
      expect(legacy[0]).toMatchObject({ id: 'req_page_250', statusId: seedIds.backlogStatusId })
      expect(legacy[0]).not.toHaveProperty('contentJson')
      expect(await database(db => db.select().from(agentSnapshots))).toEqual([])
      expect(await database(db => db.select().from(requirementAgentLocks))).toEqual([])
    })

    it('拒绝未知/重复标量、非法排序、页码及不安全偏移，缺省分页字段使用 1/20', async () => {
      const pat = await credential()
      expect(await agent(pat.token, 'requirements?pageSize=1')).toMatchObject({ page: 1, pageSize: 1, total: 0, items: [] })
      expect(await agent(pat.token, 'requirements?page=1')).toMatchObject({ page: 1, pageSize: 20 })
      for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=9007199254740991&pageSize=100',
        'pageSize=101', 'pageSize=0', 'page=1&page=2', 'q=a&q=b', 'assignee=me&assignee=unassigned',
        'sortBy=unknown', 'sortOrder=desc', 'sortBy=key&sortOrder=sideways', 'projectId=project_other', 'unknown=1', 'documentType=unknown']) {
        await expect(agent(pat.token, `requirements?${query}`)).rejects.toMatchObject({ statusCode: 400 })
      }
    })

    it('真实 CLI 创建与编辑后衔接关联，恢复原创建收据后重试关系不重复建文档', async () => {
      const pat = await credential(), target = await create(pat.token, 'instruction')
      const dir = await mkdtemp(join(tmpdir(), 'rb-discovery-cli-'))
      const cli = async (...args: string[]) => {
        const result = await promisify(execFile)(process.execPath, [resolve('skills/requirement-board/scripts/rb.mjs'), ...args], {
          env: { ...process.env, CODEX_HOME: dir, RB_BASE_URL: new URL(url('/')).origin, RB_TOKEN: pat.token },
        })
        return result.stdout
      }
      try {
        const file = join(dir, 'create.json'), snapshotFile = join(dir, 'snapshot.json'), editFile = join(dir, 'edit.json')
        await cli('new', '--create', '--out', file)
        const input = JSON.parse(await readFile(file, 'utf8'))
        await writeFile(file, JSON.stringify({ ...input, title: 'CLI 新建并关联', changeNote: '完整初版' }))
        const created = JSON.parse(await cli('submit', '--file', file))
        const recovered = JSON.parse(await cli('submit', '--file', file))
        expect(recovered.requirementId).toBe(created.requirementId)
        expect(JSON.parse(await cli('operation', created.id)).requirementId).toBe(created.requirementId)
        await expect(cli('link', created.requirementId, 'req_missing')).rejects.toThrow()
        expect(await agent(pat.token, `requirements/${created.requirementId}`)).toMatchObject({ title: 'CLI 新建并关联', latestRevision: { version: 1 } })
        await cli('link', created.requirementId, target.requirementId)
        expect(JSON.parse(await cli('related', created.requirementId))).toHaveLength(1)
        await cli('snapshot', created.requirementId, '--out', snapshotFile)
        await cli('new', '--snapshot', snapshotFile, '--out', editFile)
        const edit = JSON.parse(await readFile(editFile, 'utf8'))
        expect(edit).not.toHaveProperty('saveRevision')
        const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'))
        await writeFile(editFile, JSON.stringify({ ...edit, changeNote: '补充正文', operations: [{ op: 'insert_blocks',
          anchorDiffId: snapshot.contentJson.content[0].attrs.diffId, position: 'after', nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '补充内容' }] }] }] }))
        await cli('validate', '--file', editFile)
        expect(JSON.parse(await cli('submit', '--file', editFile)).revision).toBeNull()
        await cli('link', created.requirementId, target.requirementId)
        await cli('unlink', target.requirementId, created.requirementId)
        expect(JSON.parse(await cli('related', created.requirementId))).toEqual([])
        expect(await apiFetch(`/api/requirements/${created.requirementId}/revisions`)).toHaveLength(1)
        const listed = JSON.parse(await cli('list', '--query', 'CLI', '--page-size', '1'))
        expect(listed).toMatchObject({ total: 1, page: 1, pageSize: 1, hasMore: false, nextPage: null })
      } finally {
        if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('rb-discovery-cli-')) throw new Error('Invalid CLI test cleanup path')
        await rm(dir, { recursive: true })
      }
    }, 30_000)
  })
}
