import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createDatabase } from '../../server/db/client'
import { resetLocalDatabase } from '../../server/db/reset-local'
import { seedDatabase, seedManuals, validateSeedManuals } from '../../server/db/seed-data'
import { agentTokens, authAccounts, authSessions, requirementCollaborationDocuments, requirementRevisions, requirements, users } from '../../server/db/schema'
import { decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import { extractPlainText } from '../../shared/editor/document'
import { richTextProseMirrorSchema } from '../../shared/editor/validation'
import { TEST_ADMIN_PASSWORD, TEST_DATABASE_URL } from '../setup/db'

interface Harness {
  apiFetch: <T = unknown>(url: string, options?: Record<string, any>) => Promise<T>
  createRequirement: (title?: string) => Promise<Record<string, any>>
  readSessionCookie: (response: Response) => string
}

export function registerSeedTests({ apiFetch, createRequirement, readSessionCookie }: Harness) {
  describe('手册种子与本机重置', () => {
    it('清理业务数据，保留管理员认证，手册可读可保存并隔离旧编辑', async () => {
      const { client, db } = createDatabase(TEST_DATABASE_URL)
      try {
        const response = await fetch('/api/auth/sign-in/username', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
        })
        expect(response.status).toBe(200)
        const cookie = readSessionCookie(response)
        const adminFetch = <T = any>(url: string, options: Record<string, any> = {}) => $fetch<T>(url, { ...options, headers: { 'x-rb-document-schema': '3', 'x-rb-document-capabilities': 'task_lists,details', cookie } })
        await adminFetch('/api/account/agent-tokens', { method: 'POST', body: { name: '保留的管理员 AI 凭证' } })
        const memberToken = await apiFetch<{ token: string }>('/api/account/agent-tokens', { method: 'POST', body: { name: '清理的成员 AI 凭证' } })
        const dirty = await createRequirement('清理的旧需求')
        const related = await createRequirement('清理的关联文档')
        await apiFetch(`/api/requirements/${dirty.id}/related`, { method: 'POST', body: { documentIds: [related.id] } })
        const snapshot = await $fetch<{ id: string }>(`/api/agent/v1/requirements/${dirty.id}/snapshot`, {
          method: 'POST', headers: { authorization: `Bearer ${memberToken.token}` }, body: {},
        })
        await $fetch('/api/agent/v1/operations', {
          method: 'POST', headers: { authorization: `Bearer ${memberToken.token}` },
          body: { snapshotId: snapshot.id, requestId: 'seed_reset_dirty_operation', changeNote: '清理的操作', operations: [{ op: 'set_title', title: '旧文档' }] },
        })
        await db.update(requirementCollaborationDocuments).set({ editEpoch: 12 })
        const preserved = {
          account: await db.select().from(authAccounts).where(eq(authAccounts.userId, 'admin')),
          session: await db.select().from(authSessions).where(eq(authSessions.userId, 'admin')),
          token: await db.select().from(agentTokens).where(eq(agentTokens.userId, 'admin')),
          user: await db.select().from(users).where(eq(users.id, 'admin')),
        }
        const reset = await resetLocalDatabase(db)
        expect(reset).toEqual({ created: 7, skipped: 0, editEpoch: 13 })
        expect(await db.select().from(users)).toEqual(preserved.user)
        expect(await db.select().from(authAccounts)).toEqual(preserved.account)
        expect(await db.select().from(authSessions)).toEqual(preserved.session)
        expect(await db.select().from(agentTokens)).toEqual(preserved.token)
        for (const table of ['agent_snapshots', 'agent_suggestions', 'requirement_agent_locks', 'requirement_edit_events',
          'requirement_drafts', 'requirement_draft_assets', 'requirement_relations', 'assets', 'audit_events', 'project_access_requests', 'project_invitations']) {
          const [{ count }] = await client.unsafe(`select count(*)::int as count from ${table}`)
          expect(count, table).toBe(0)
        }
        const rows = await db.select().from(requirements).orderBy(requirements.key)
        expect(rows.map(row => row.key)).toEqual(['REQ-1', 'REQ-2', 'REQ-3', 'REQ-4', 'REQ-5', 'REQ-6', 'REQ-7'])
        expect(await adminFetch('/api/requirements')).toMatchObject({ total: 7 })
        await expect(adminFetch(`/api/requirements/${dirty.id}`)).rejects.toMatchObject({ statusCode: 404 })

        for (const manual of validateSeedManuals()) {
          const detail = await adminFetch(`/api/requirements/${manual.id}`)
          expect(detail.currentRevision.version).toBe(1)
          // 持久化正文经过真实节点 schema，补齐可省略属性的默认值，保留所有身份与内容。
          expect(detail.currentRevision.contentJson).toEqual(richTextProseMirrorSchema.nodeFromJSON(manual.contentJson).toJSON())
          expect(detail.currentRevision.contentText).toBe(extractPlainText(detail.currentRevision.contentJson))
          const loaded = await adminFetch(`/api/requirements/${manual.id}/collaboration`, { method: 'POST', body: {} })
          const doc = new Y.Doc()
          try {
            Y.applyUpdate(doc, decodeCollaborationState(loaded.state))
            expect(readCollaborationDocument(doc).contentJson).toEqual(detail.currentRevision.contentJson)
          } finally { doc.destroy() }
          expect(loaded.initialized).toBe(false)
          expect(loaded.editEpoch).toBe(13)
        }
        const manual = seedManuals[0]!
        const loaded = await adminFetch(`/api/requirements/${manual.id}/collaboration`, { method: 'POST', body: {} })
        const staleCopy = new Y.Doc()
        Y.applyUpdate(staleCopy, decodeCollaborationState(loaded.state))
        const vector = Y.encodeStateVector(staleCopy)
        staleCopy.getText('title').insert(0, '旧编辑不应写入')
        const staleEdit = { id: 'edit_seed_reset_old_epoch_12345678', clientId: staleCopy.clientID, intent: 'edit',
          update: Buffer.from(Y.encodeStateAsUpdate(staleCopy, vector)).toString('base64') }
        staleCopy.destroy()
        await expect(adminFetch(`/api/requirements/${manual.id}/edits`, {
          method: 'POST', body: { editEpoch: 12, edits: [staleEdit] },
        })).rejects.toMatchObject({ statusCode: 409 })
        const revision = await adminFetch(`/api/requirements/${manual.id}/revisions`, {
          method: 'POST', body: { title: manual.title, contentJson: manual.contentJson, changeNote: '种子保存验收',
            collaborationUpdate: loaded.state, editEpoch: loaded.editEpoch, clientSaveId: 'seed_roundtrip_save' },
        })
        expect(revision.version).toBe(2)
        const beforeSeed = await db.select().from(requirementRevisions)
        expect(await db.transaction(tx => seedDatabase(tx))).toEqual({ created: 0, skipped: 7 })
        expect(await db.select().from(requirementRevisions)).toEqual(beforeSeed)
      } finally { await client.end() }
    })

    it('全新库只创建管理员和七篇手册，不创建默认密码或演示账号', async () => {
      const { client, db } = createDatabase(TEST_DATABASE_URL)
      try {
        await db.execute(sql`truncate users, projects cascade`)
        await db.transaction(tx => seedDatabase(tx))
        expect((await db.select().from(users)).map(user => user.id)).toEqual(['admin'])
        expect(await db.select().from(authAccounts)).toEqual([])
        expect(await db.select().from(requirements)).toHaveLength(7)
        expect(await db.select().from(requirementRevisions)).toHaveLength(7)
        const [{ count }] = await client`select count(*)::int as count from project_members`
        expect(count).toBe(1)
      } finally { await client.end() }
    })

    it('种子写入失败时，整次清理回滚', async () => {
      const { client, db } = createDatabase(TEST_DATABASE_URL)
      try {
        const dirty = await createRequirement('应当保留的旧需求')
        // 约束只存在于独立测试库，模拟清理后插入种子失败。
        await client`alter table requirements add constraint test_reject_seed check (title not like '%使用手册%')`
        await expect(resetLocalDatabase(db)).rejects.toThrow()
        expect(await db.select().from(users)).toHaveLength(5)
        expect((await db.select().from(requirements)).map(row => row.id)).toEqual([dirty.id])
      } finally {
        await client`alter table requirements drop constraint if exists test_reject_seed`
        await client.end()
      }
    })
  })
}
