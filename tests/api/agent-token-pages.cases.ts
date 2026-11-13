import { $fetch } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../server/db/client'
import { agentTokens, projectMembers, users } from '../../server/db/schema'
import { agentTokenStatus, type AgentTokenPage } from '../../shared/agent/tokens'
import { seedIds, TEST_DATABASE_URL } from '../setup/db'

type Api = <T = any>(path: string, options?: Record<string, any>) => Promise<T>
export function registerAgentTokenPageTests({ apiFetch }: { apiFetch: Api }) {
  async function database<T>(work: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>) {
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try { return await work(db) } finally { await client.end() }
  }
  const list = (query: Record<string, unknown> = {}) => apiFetch<AgentTokenPage>('/api/account/agent-tokens', { query })
  const row = (index: number, extra: Partial<typeof agentTokens.$inferInsert> = {}) => ({
    id: `page_pat_${String(index).padStart(3, '0')}`, name: `凭证 ${index}`, tokenHash: `unused-test-hash-${index}`,
    userId: seedIds.currentUserId, createdAt: new Date('2026-10-01T00:00:00Z'),
    expiresAt: new Date(Date.now() + (index < 4 ? 1 : -1) * 86400_000),
    revokedAt: index >= 12 ? new Date('2026-10-10T00:00:00Z') : null, ...extra,
  })

  describe('本人凭证服务端分页', () => {
    it('按数据库分页和稳定顺序返回，状态计数与全部有效数量独立，不泄漏其他账号或哈希', async () => {
      await database(db => db.insert(agentTokens).values([...Array.from({ length: 23 }, (_, i) => row(i)), row(99, { userId: seedIds.designUserId })]))
      const first = await list()
      expect(first).toMatchObject({ total: 23, page: 1, limit: 10, activeCount: 4 })
      expect(first.items.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => row(22 - i).id))
      expect((await list({ page: 3 })).items).toHaveLength(3)
      expect(await list({ page: 4 })).toMatchObject({ items: [], total: 23, page: 4, activeCount: 4 })
      for (const [status, total] of [['active', 4], ['expired', 8], ['revoked', 11]] as const) {
        const found = await list({ status, limit: 50 })
        expect(found).toMatchObject({ total, activeCount: 4 })
        expect(found.items.every(item => agentTokenStatus(item, found.asOf) === status)).toBe(true)
      }
      expect(Object.keys(first.items[0]!).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'name', 'revokedAt'])
    })

    it('创建与撤销立即更新计数，筛选末页可返回空页，过期或撤销记录不占有效名额', async () => {
      await database(db => db.insert(agentTokens).values(Array.from({ length: 23 }, (_, i) => row(i))))
      const created = await apiFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '新工作电脑' } })
      expect((await list()).items[0]!.id).toBe(created.id)
      expect((await list()).activeCount).toBe(5)
      await apiFetch(`/api/account/agent-tokens/${created.id}/revoke`, { method: 'POST' })
      expect(await list({ status: 'active', page: 5, limit: 1 })).toMatchObject({ items: [], total: 4, activeCount: 4 })
      expect((await list({ status: 'revoked' })).items[0]!.id).toBe(created.id)
      await database(db => db.update(agentTokens).set({ expiresAt: new Date(0) }).where(eq(agentTokens.id, 'page_pat_000')))
      expect((await list()).activeCount).toBe(3)
    })

    it('拒绝非法参数，不能指定他人或脱离项目权限读取凭证', async () => {
      await expect($fetch('/api/account/agent-tokens')).rejects.toMatchObject({ statusCode: 401 })
      for (const query of [{ page: 0 }, { page: '1.5' }, { limit: 101 }, { status: 'unknown' }, { status: ['all', 'active'] }, { userId: seedIds.designUserId }]) {
        await expect(list(query)).rejects.toMatchObject({ statusCode: 400 })
      }
      await database(db => db.delete(projectMembers).where(eq(projectMembers.userId, seedIds.currentUserId)))
      await expect(list()).rejects.toMatchObject({ statusCode: 403 })
      await database(db => db.update(users).set({ role: 'admin' }).where(eq(users.id, seedIds.currentUserId)))
      expect(await list()).toMatchObject({ total: 0, activeCount: 0 })
      await database(db => db.update(users).set({ banned: true }).where(eq(users.id, seedIds.currentUserId)))
      await expect(list()).rejects.toMatchObject({ statusCode: 403 })
    })
  })
}
