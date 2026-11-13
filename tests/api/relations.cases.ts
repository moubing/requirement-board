import { $fetch } from '@nuxt/test-utils/e2e'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../../server/db/client'
import { projectMembers, requirementAgentLocks, requirementRelations, requirements } from '../../server/db/schema'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'
import type { RelatedDocumentDto } from '../../shared/requirements/relations'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerRelationTests({ apiFetch, createRequirement }: { apiFetch: Api; createRequirement: (title?: string) => Promise<Record<string, any>> }) {
  const url = (id: string) => `/api/requirements/${id}/related`
  const list = (id: string) => apiFetch<RelatedDocumentDto[]>(url(id))
  const add = (id: string, documentIds: string[]) => apiFetch<RelatedDocumentDto[]>(url(id), { method: 'POST', body: { documentIds } })
  const remove = (id: string, target: string) => apiFetch<RelatedDocumentDto[]>(`${url(id)}/${target}`, { method: 'DELETE' })
  async function database<T>(work: (db: Database) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  async function foreignDocument() {
    return database(async db => (await db.insert(requirements).values({ id: 'other-document', key: 'OTHER-1', title: '其他项目文档',
      projectId: seedIds.otherProjectId, statusId: seedIds.otherStatusId, reporterId: seedIds.outsiderUserId }).returning())[0]!)
  }

  describe('双向关联文档', () => {
    it('批量、反向和并发重试只保存一份关系，双方可解除且不创建正文版本', async () => {
      const a = await createRequirement('账号安全'), b = await createRequirement('注册流程'), c = await createRequirement('找回密码')
      expect(await list(a.id)).toEqual([])
      await Promise.all([add(a.id, [b.id, c.id, b.id]), add(b.id, [a.id]), add(c.id, [a.id])])
      expect((await list(a.id)).map(item => item.id).sort()).toEqual([b.id, c.id].sort())
      expect(await list(b.id)).toMatchObject([{ id: a.id, title: '账号安全', status: { id: a.status.id } }])
      expect(await database(db => db.select().from(requirementRelations))).toHaveLength(2)
      await add(a.id, [b.id])
      expect(await database(db => db.select().from(requirementRelations))).toHaveLength(2)
      await remove(b.id, a.id)
      await remove(b.id, a.id)
      expect(await list(b.id)).toEqual([])
      expect((await list(a.id)).map(item => item.id)).toEqual([c.id])
      for (const id of [a.id, b.id, c.id]) expect(await apiFetch(`/api/requirements/${id}/revisions`)).toHaveLength(1)
      await apiFetch(`/api/requirements/${c.id}`, { method: 'PATCH', body: { title: '找回密码与验证' } })
      expect(await list(a.id)).toMatchObject([{ id: c.id, title: '找回密码与验证' }])
    })

    it('拒绝自身、空选择、非法参数及不存在的文档，失败时整批回滚', async () => {
      const a = await createRequirement(), b = await createRequirement()
      for (const body of [{ documentIds: [] }, { documentIds: [a.id] }, { documentIds: [3] }, { documentIds: [b.id], extra: true },
        { documentIds: Array.from({ length: 101 }, () => b.id) }]) {
        await expect(apiFetch(url(a.id), { method: 'POST', body })).rejects.toMatchObject({ statusCode: 400 })
      }
      await expect(add(a.id, [b.id, 'missing'])).rejects.toMatchObject({ statusCode: 404 })
      await expect(remove(a.id, a.id)).rejects.toMatchObject({ statusCode: 400 })
      await expect(list('missing')).rejects.toMatchObject({ statusCode: 404 })
      expect(await list(a.id)).toEqual([])
      expect(await list(b.id)).toEqual([])
    })

    it('所有接口校验会话、项目权限、Origin 和双方归属', async () => {
      const a = await createRequirement(), b = await createRequirement(), other = await foreignDocument()
      await add(a.id, [b.id])
      await expect($fetch(url(a.id))).rejects.toMatchObject({ statusCode: 401 })
      await expect($fetch(url(a.id), { method: 'POST', body: { documentIds: [b.id] } })).rejects.toMatchObject({ statusCode: 401 })
      await expect($fetch(`${url(a.id)}/${b.id}`, { method: 'DELETE' })).rejects.toMatchObject({ statusCode: 401 })
      await expect(list(other.id)).rejects.toMatchObject({ statusCode: 404 })
      await expect(add(a.id, [b.id, other.id])).rejects.toMatchObject({ statusCode: 404 })
      await expect(add(other.id, [a.id])).rejects.toMatchObject({ statusCode: 404 })
      await expect(remove(a.id, other.id)).rejects.toMatchObject({ statusCode: 404 })
      await expect(apiFetch(url(a.id), { method: 'POST', headers: { origin: 'https://attacker.example.com' }, body: { documentIds: [b.id] } })).rejects.toMatchObject({ statusCode: 403 })
      expect((await list(a.id)).map(item => item.id)).toEqual([b.id])
      await database(db => db.delete(projectMembers).where(and(eq(projectMembers.projectId, seedIds.projectId), eq(projectMembers.userId, seedIds.currentUserId))))
      await expect(list(a.id)).rejects.toMatchObject({ statusCode: 403 })
      await expect(add(a.id, [b.id])).rejects.toMatchObject({ statusCode: 403 })
      await expect(remove(a.id, b.id)).rejects.toMatchObject({ statusCode: 403 })
    })

    it('任意一侧的有效 AI 锁会阻止整批新增和解除，读取不受影响', async () => {
      const a = await createRequirement(), b = await createRequirement(), c = await createRequirement()
      await add(a.id, [b.id])
      const pat = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '关联锁验证' } })
      await $fetch(`/api/agent/v1/requirements/${b.id}/snapshot`, { method: 'POST', headers: { authorization: `Bearer ${pat.token}` }, body: {} })
      await expect(add(a.id, [c.id, b.id])).rejects.toMatchObject({ statusCode: 423 })
      await expect(remove(a.id, b.id)).rejects.toMatchObject({ statusCode: 423 })
      await expect(remove(b.id, a.id)).rejects.toMatchObject({ statusCode: 423 })
      expect((await list(a.id)).map(item => item.id)).toEqual([b.id])
      expect(await list(c.id)).toEqual([])
      await database(db => db.update(requirementAgentLocks).set({ expiresAt: new Date(0) }).where(eq(requirementAgentLocks.requirementId, b.id)))
      expect(await remove(a.id, b.id)).toEqual([])
    })

    it('数据库拒绝跨项目、反向和自身关系，删除一侧级联清理关联', async () => {
      const a = await createRequirement(), b = await createRequirement(), other = await foreignDocument()
      const [firstId, secondId] = [a.id, b.id].sort()
      await database(async db => {
        await expect(db.insert(requirementRelations).values({ projectId: seedIds.projectId, firstId: a.id, secondId: a.id })).rejects.toThrow()
        await expect(db.insert(requirementRelations).values({ projectId: seedIds.projectId, firstId: secondId!, secondId: firstId! })).rejects.toThrow()
        const pair = [a.id, other.id].sort()
        await expect(db.insert(requirementRelations).values({ projectId: seedIds.projectId, firstId: pair[0]!, secondId: pair[1]! })).rejects.toThrow()
      })
      await add(a.id, [b.id])
      await database(db => db.delete(requirements).where(eq(requirements.id, b.id)))
      expect(await list(a.id)).toEqual([])
      expect((await apiFetch(`/api/requirements/${a.id}`)).id).toBe(a.id)
    })

    it('后续写入失败时回滚关联与双方更新时间', async () => {
      const a = await createRequirement(), b = await createRequirement()
      const before = await database(db => db.select().from(requirements).orderBy(requirements.id))
      await database(async db => {
        await db.execute(sql`alter table requirements add constraint test_relation_update_reject check (updated_at = created_at) not valid`)
        try { await expect(add(a.id, [b.id])).rejects.toMatchObject({ statusCode: 500 }) }
        finally { await db.execute(sql`alter table requirements drop constraint test_relation_update_reject`) }
      })
      expect(await list(a.id)).toEqual([])
      expect(await list(b.id)).toEqual([])
      const after = await database(db => db.select().from(requirements).orderBy(requirements.id))
      expect(after.map(row => [row.id, row.updatedAt])).toEqual(before.map(row => [row.id, row.updatedAt]))
    })
  })
}
