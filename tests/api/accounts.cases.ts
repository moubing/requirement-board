import { randomBytes } from 'node:crypto'
import { $fetch, fetch } from '@nuxt/test-utils/e2e'
import { and, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { AccountAccess, AccountAudit, Invitation, ManagedUser, PageResult } from '../../shared/auth/access'
import { createDatabase, type Database } from '../../server/db/client'
import { auditEvents, authAccounts, authSessions, projectAccessRequests, projectInvitations, projectMemberRoles, projectMembers, users } from '../../server/db/schema'
import { writeAudit } from '../../server/services/audit'
import { hashInvitationToken } from '../../server/services/invitation-token'
import { seedIds, TEST_ADMIN_PASSWORD, TEST_DATABASE_URL, TEST_USER_PASSWORD } from '../setup/db'

// 共用需求 API 的服务和 beforeEach，避免多个测试文件同时清空同一数据库。
export function registerAccountTests(helpers: { readSessionCookie: (response: Response) => string; getMemberCookie: () => string }) {
  function client(cookie: string) {
    return <T = any>(path: string, options: Record<string, any> = {}) =>
      $fetch<T>(path, { ...options, headers: { ...options.headers, cookie } })
  }
  async function admin() {
    const response = await fetch('/api/auth/sign-in/username', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
    })
    expect(response.status).toBe(200)
    return client(helpers.readSessionCookie(response))
  }
  async function memberLogin() {
    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'mobing@example.com', password: TEST_USER_PASSWORD }),
    })
    expect(response.status).toBe(200)
    return client(helpers.readSessionCookie(response))
  }
  async function register(email = 'new@example.com', extra: Record<string, unknown> = {}) {
    const response = await fetch('/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New colleague', email, password: TEST_USER_PASSWORD, ...extra }),
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    return { id: data.user.id as string, api: client(helpers.readSessionCookie(response)) }
  }
  async function database<T>(action: (db: Database) => Promise<T>) {
    const { db, client: connection } = createDatabase(TEST_DATABASE_URL)
    try { return await action(db) } finally { await connection.end() }
  }
  function createInvite(api: ReturnType<typeof client>, email = 'new@example.com', roles = ['developer', 'qa']) {
    return api<{ invitation: Invitation; url: string }>('/api/admin/invitations', {
      method: 'POST', body: { name: 'New colleague', email, roles },
    })
  }
  function token(url: string) { return new URL(url).hash.slice(1) }
  const getAccess = (api: ReturnType<typeof client>) => api<AccountAccess>('/api/account/access')

  const newUserInput = () => ({ name: '直接创建同事', username: 'created.colleague', email: 'created@example.com', password: TEST_USER_PASSWORD, roles: ['developer', 'qa'] })

  describe('administrator account creation', () => {
    it('creates a usable account and multiple roles without replacing the admin session or creating an application', async () => {
      const login = await fetch('/api/auth/sign-in/username', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
      })
      const cookie = helpers.readSessionCookie(login)
      const api = client(cookie)
      const input = { ...newUserInput(), name: '  直接创建同事  ', username: ' Created.Colleague ', email: ' Created@Example.com ', roles: ['qa', 'developer', 'qa'] }
      const response = await fetch('/api/admin/users', {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      const result = await response.json()
      const id = result.user.id
      expect(result.user).toMatchObject({ name: '直接创建同事', username: 'created.colleague', email: 'created@example.com', role: 'user' })
      expect(JSON.stringify(result)).not.toContain(input.password)
      expect((await getAccess(api)).user.id).toBe(seedIds.adminUserId)

      await database(async (db) => {
        expect(await db.query.users.findFirst({ where: eq(users.id, id) })).toMatchObject({ banned: false, emailVerified: false })
        expect(await db.select().from(authSessions).where(eq(authSessions.userId, id))).toHaveLength(0)
        expect(await db.select().from(projectAccessRequests).where(eq(projectAccessRequests.userId, id))).toHaveLength(0)
        const accounts = await db.select().from(authAccounts).where(eq(authAccounts.userId, id))
        expect(accounts).toHaveLength(1)
        expect(accounts[0]).toMatchObject({ accountId: id, providerId: 'credential' })
        expect(accounts[0]!.password).not.toBe(input.password)
        expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, id))).toEqual([expect.objectContaining({ projectId: seedIds.projectId, userId: id })])
        expect((await db.select().from(projectMemberRoles).where(eq(projectMemberRoles.userId, id))).map((row) => row.role).sort()).toEqual(['developer', 'qa'])
        const events = await db.select().from(auditEvents).where(eq(auditEvents.subjectUserId, id))
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ action: 'user.create', actorId: seedIds.adminUserId, targetId: id, detail: {
          name: '直接创建同事', username: 'created.colleague', email: 'created@example.com', systemRole: 'user', projectRoles: ['developer', 'qa'],
        } })
        expect(JSON.stringify(events)).not.toContain(input.password)
        expect(JSON.stringify(events)).not.toContain(accounts[0]!.password!)
      })
      for (const [method, credentials] of [['username', { username: 'CREATED.COLLEAGUE' }], ['email', { email: 'created@example.com' }]] as const) {
        const signIn = await fetch(`/api/auth/sign-in/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...credentials, password: input.password }),
        })
        expect(signIn.status).toBe(200)
        const member = client(helpers.readSessionCookie(signIn))
        expect(await getAccess(member)).toMatchObject({ user: { id }, canAccessProject: true, projectRoles: ['developer', 'qa'], request: null })
        expect(Array.isArray((await member('/api/requirements')).items)).toBe(true)
      }
    })

    it('allows an explicit admin identity and empty project roles while rejecting untrusted callers', async () => {
      const input = newUserInput()
      await expect($fetch('/api/admin/users', { method: 'POST', body: input })).rejects.toMatchObject({ statusCode: 401 })
      await expect(client(helpers.getMemberCookie())('/api/admin/users', { method: 'POST', body: input })).rejects.toMatchObject({ statusCode: 403 })
      const api = await admin()
      await expect(api('/api/admin/users', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: input })).rejects.toMatchObject({ statusCode: 403 })
      await api(`/api/members/${seedIds.currentUserId}/roles`, { method: 'PUT', body: { roles: ['project_admin'] } })
      await expect(client(helpers.getMemberCookie())('/api/admin/users', { method: 'POST', body: input })).rejects.toMatchObject({ statusCode: 403 })
      const result = await api('/api/admin/users', { method: 'POST', body: { ...input, systemRole: 'admin', roles: [] } })
      expect(result.user.role).toBe('admin')
      const signIn = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: input.username, password: input.password }) })
      const newAdmin = client(helpers.readSessionCookie(signIn))
      expect(await getAccess(newAdmin)).toMatchObject({ canAccessProject: true, projectRoles: [], request: null })
      expect(await newAdmin('/api/admin/users')).toHaveProperty('items')
    })

    it('validates required fields and rejects fields outside the creation contract', async () => {
      const api = await admin()
      for (const input of [{}, ...[
        { name: '   ' }, { username: 'ab' }, { username: 'invalid-name' }, { email: 'invalid' },
        { password: '12345' }, { password: 'x'.repeat(129) }, { roles: ['root'] }, { systemRole: 'root' },
        { role: 'admin' }, { banned: true }, { emailVerified: true },
      ].map((override) => ({ ...newUserInput(), ...override }))]) {
        await expect(api('/api/admin/users', { method: 'POST', body: input })).rejects.toMatchObject({ statusCode: 400 })
      }
      await database(async (db) => {
        expect(await db.select().from(users).where(eq(users.email, 'created@example.com'))).toHaveLength(0)
        expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'user.create'))).toHaveLength(0)
      })
    })

    it('rejects duplicate accounts, preserves pending applicants and invalidates an invitation only after successful direct creation', async () => {
      const api = await admin()
      const invite = await createInvite(api, 'created@example.com')
      const results = await Promise.allSettled([1, 2].map(() => api('/api/admin/users', { method: 'POST', body: newUserInput() })))
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      await expect(api('/api/admin/users', { method: 'POST', body: { ...newUserInput(), username: 'another', email: 'CREATED@EXAMPLE.COM' } })).rejects.toMatchObject({ statusCode: 409 })
      await expect(api('/api/admin/users', { method: 'POST', body: { ...newUserInput(), username: 'CREATED.COLLEAGUE', email: 'another@example.com' } })).rejects.toMatchObject({ statusCode: 409 })
      await expect($fetch('/api/invitations/preview', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 410 })

      const pendingInvite = await createInvite(api, 'pending@example.com')
      const pending = await register('pending@example.com')
      await expect(api('/api/admin/users', { method: 'POST', body: { ...newUserInput(), username: 'pending.colleague', email: 'pending@example.com' } })).rejects.toMatchObject({ statusCode: 409 })
      expect(await getAccess(pending.api)).toMatchObject({ canAccessProject: false, request: { status: 'pending' } })
      expect(await $fetch('/api/invitations/preview', { method: 'POST', body: { token: token(pendingInvite.url) } })).toMatchObject({ status: 'pending' })
      await database(async (db) => {
        expect(await db.select().from(users).where(eq(users.email, 'created@example.com'))).toHaveLength(1)
        expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'user.create'))).toHaveLength(1)
      })
    })

    it('rolls back the account, credential, membership and invitation changes if audit writing fails', async () => {
      const api = await admin()
      const invite = await createInvite(api, 'created@example.com')
      await database(async (db) => {
        const credentialsBefore = await db.select().from(authAccounts)
        const membersBefore = await db.select().from(projectMembers)
        await db.execute(sql`alter table audit_events add constraint test_reject_user_creation check (action <> 'user.create')`)
        try {
          const error = await api('/api/admin/users', { method: 'POST', body: newUserInput() }).catch((error: unknown) => error)
          expect(error).toMatchObject({ statusCode: 500, data: { message: '创建用户失败，请稍后重试' } })
          expect(JSON.stringify(error)).not.toContain(TEST_USER_PASSWORD)
          expect(await db.select().from(users).where(eq(users.email, 'created@example.com'))).toHaveLength(0)
          expect(await db.select().from(authAccounts)).toEqual(credentialsBefore)
          expect(await db.select().from(projectMembers)).toEqual(membersBefore)
          expect(await db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) })).toMatchObject({ status: 'pending' })
        } finally {
          await db.execute(sql`alter table audit_events drop constraint test_reject_user_creation`)
        }
      })
      expect(await api('/api/admin/users', { method: 'POST', body: newUserInput() })).toHaveProperty('user.id')
    })

    it('lets a created user change the initial password and revokes other sessions without affecting the admin', async () => {
      const api = await admin()
      const input = newUserInput()
      await api('/api/admin/users', { method: 'POST', body: input })
      const signIn = () => fetch('/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: input.email, password: input.password }),
      })
      const firstCookie = helpers.readSessionCookie(await signIn())
      const otherDevice = client(helpers.readSessionCookie(await signIn()))
      const change = (currentPassword: string) => fetch('/api/auth/change-password', {
        method: 'POST', headers: { cookie: firstCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword: 'new-user-password', revokeOtherSessions: true }),
      })
      expect((await change('incorrect-password')).status).toBe(400)
      const response = await change(input.password)
      expect(response.status).toBe(200)
      const currentDevice = client(helpers.readSessionCookie(response))
      expect((await getAccess(currentDevice)).canAccessProject).toBe(true)
      await expect(getAccess(otherDevice)).rejects.toMatchObject({ statusCode: 401 })
      expect((await signIn()).status).toBe(401)
      const newLogin = await fetch('/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: input.email, password: 'new-user-password' }),
      })
      expect(newLogin.status).toBe(200)
      expect((await getAccess(api)).user.id).toBe(seedIds.adminUserId)
    })
  })

  describe('account registration and approval', () => {
    it('returns the stored avatar color with account access without exposing private user fields', async () => {
      await database(db => db.update(users).set({ avatarColor: '#a06424' }).where(eq(users.id, seedIds.currentUserId)))
      const access = await getAccess(client(helpers.getMemberCookie()))
      expect(access.user.avatarColor).toBe('#a06424')
      expect(Object.keys(access.user).sort()).toEqual(['avatarColor', 'email', 'id', 'name', 'role', 'username'])
    })
    it('creates a pending account, supports username login, and isolates project data', async () => {
      const user = await register('new@example.com', { username: 'newcolleague' })
      expect(await getAccess(user.api)).toMatchObject({ user: { id: user.id, role: 'user' }, canAccessProject: false, projectRoles: [], request: { status: 'pending' } })
      const upload = new FormData()
      upload.append('file', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'private.png')
      const asset = await client(helpers.getMemberCookie())('/api/assets/upload', { method: 'POST', body: upload })
      await expect(user.api(asset.url)).rejects.toMatchObject({ statusCode: 403 })
      for (const path of ['/api/meta', '/api/requirements', '/api/revisions/missing', '/api/members', '/api/admin/users', '/api/admin/requests']) {
        await expect(user.api(path)).rejects.toMatchObject({ statusCode: 403 })
      }
      await expect(user.api('/api/requirements', { method: 'POST', body: { title: 'Not allowed' } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(user.api('/api/assets/upload', { method: 'POST', body: new FormData() })).rejects.toMatchObject({ statusCode: 403 })
      const login = await fetch('/api/auth/sign-in/username', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'newcolleague', password: TEST_USER_PASSWORD }),
      })
      expect(login.status).toBe(200)
      await database(async (db) => {
        expect(await db.query.projectMembers.findFirst({ where: eq(projectMembers.userId, user.id) })).toBeUndefined()
        expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.emailVerified).toBe(false)
      })
    })

    it('records note changes and clearing while keeping one application and ignoring unchanged submissions', async () => {
      const api = await admin()
      const user = await register()
      const requestId = (await getAccess(user.api)).request!.id
      await user.api('/api/account/request', { method: 'POST', body: { message: '222' } })
      await Promise.all([1, 2].map(() => user.api('/api/account/request', { method: 'POST', body: { message: '222' } })))
      await user.api('/api/account/request', { method: 'POST', body: { message: '' } })

      const detail = await api<{ audit: AccountAudit[] }>(`/api/admin/users/${user.id}`)
      expect(detail.audit).toHaveLength(3)
      expect(detail.audit).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'request.submit', detail: { source: 'registration' } }),
        expect.objectContaining({ action: 'request.update', detail: expect.objectContaining({ previousMessage: '', message: '222' }) }),
        expect.objectContaining({ action: 'request.update', detail: expect.objectContaining({ previousMessage: '222', message: '' }) }),
      ]))
      expect((await getAccess(user.api)).request).toMatchObject({ id: requestId, status: 'pending', message: '' })
      await database(async (db) => {
        expect(await db.select().from(projectAccessRequests).where(eq(projectAccessRequests.userId, user.id))).toHaveLength(1)
        const events = await db.select().from(auditEvents).where(eq(auditEvents.subjectUserId, user.id))
        for (const event of events) expect(event).toMatchObject({ actorId: user.id, targetId: requestId, projectId: seedIds.projectId })
      })
    })

    it('rejects privilege injection during signup and self profile changes', async () => {
      await expect($fetch('/api/auth/sign-up/email', { method: 'POST', body: {
        name: 'Injected', email: 'injected@example.com', password: TEST_USER_PASSWORD, role: 'admin', banned: false,
      } })).rejects.toMatchObject({ statusCode: 400 })
      const user = await register()
      await expect(user.api('/api/auth/update-user', { method: 'POST', body: { name: 'Updated', role: 'admin', banned: false } })).rejects.toMatchObject({ statusCode: 400 })
      await user.api('/api/auth/update-user', { method: 'POST', body: { name: 'Allowed name' } })
      expect((await getAccess(user.api)).user).toMatchObject({ role: 'user', name: 'Allowed name' })
      await expect(user.api('/api/account/request', { method: 'POST', body: { message: 'Join', userId: seedIds.adminUserId, roles: ['project_admin'] } })).rejects.toMatchObject({ statusCode: 400 })
      expect((await getAccess(user.api)).canAccessProject).toBe(false)
    })

    it('keeps the application pending when approval roles are missing, empty or invalid', async () => {
      const api = await admin()
      const user = await register()
      const requestId = (await getAccess(user.api)).request!.id
      for (const body of [{ decision: 'approve' }, { decision: 'approve', roles: [] }, { decision: 'approve', roles: ['root'] }]) {
        await expect(api(`/api/admin/requests/${requestId}/review`, { method: 'POST', body })).rejects.toMatchObject({ statusCode: 400 })
      }
      expect(await getAccess(user.api)).toMatchObject({ canAccessProject: false, projectRoles: [], request: { status: 'pending' } })
      await database(async (db) => {
        expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, user.id))).toHaveLength(0)
        expect(await db.select().from(auditEvents).where(and(eq(auditEvents.subjectUserId, user.id), eq(auditEvents.action, 'request.approve')))).toHaveLength(0)
      })
    })

    it('approves once with multiple roles and grants access to the existing session', async () => {
      const api = await admin()
      const user = await register()
      await user.api('/api/account/request', { method: 'POST', body: { message: '负责开发和测试' } })
      const requestId = (await getAccess(user.api)).request!.id
      await Promise.all([1, 2].map(() => api(`/api/admin/requests/${requestId}/review`, {
        method: 'POST', body: { decision: 'approve', roles: ['developer', 'qa', 'developer'], note: '身份已确认' },
      })))
      expect(await getAccess(user.api)).toMatchObject({ canAccessProject: true, projectRoles: ['developer', 'qa'], request: { status: 'approved' } })
      expect((await user.api('/api/meta')).currentUserId).toBe(user.id)
      expect((await user.api('/api/requirements', { method: 'POST', body: { title: '多角色成员创建' } })).reporter.id).toBe(user.id)
      await database(async (db) => {
        expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, user.id))).toHaveLength(1)
        expect(await db.select().from(auditEvents).where(and(eq(auditEvents.subjectUserId, user.id), eq(auditEvents.action, 'request.approve')))).toHaveLength(1)
      })
      const listed = await api<PageResult<ManagedUser>>('/api/admin/users', { query: { role: 'qa', search: 'new@', status: 'active', limit: 1 } })
      expect(listed).toMatchObject({ total: 1, limit: 1, items: [{ id: user.id, projectRoles: ['developer', 'qa'] }] })
      const detail = await api(`/api/admin/users/${user.id}`)
      expect(detail.audit.map((event: AccountAudit) => event.action)).toEqual(['request.approve', 'request.update', 'request.submit'])
      expect(JSON.stringify(detail)).not.toContain('password')
      expect(JSON.stringify(detail)).not.toContain('token')
    })

    it('requires a rejection reason, permits reapplication and keeps the prior review in audit', async () => {
      const api = await admin()
      const user = await register()
      const requestId = (await getAccess(user.api)).request!.id
      await user.api('/api/account/request', { method: 'POST', body: { message: '初次申请说明' } })
      await expect(api(`/api/admin/requests/${requestId}/review`, { method: 'POST', body: { decision: 'reject' } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(api(`/api/admin/requests/${requestId}/review`, { method: 'POST', body: { decision: 'reject', note: '   ' } })).rejects.toMatchObject({ statusCode: 400 })
      await api(`/api/admin/requests/${requestId}/review`, { method: 'POST', body: { decision: 'reject', note: '请补充团队信息' } })
      expect((await getAccess(user.api)).request).toMatchObject({ status: 'rejected', reviewNote: '请补充团队信息' })
      await user.api('/api/account/request', { method: 'POST', body: { message: '来自研发团队' } })
      expect((await getAccess(user.api)).request).toMatchObject({ id: requestId, status: 'pending', reviewNote: '', message: '来自研发团队' })
      const detail = await api(`/api/admin/users/${user.id}`)
      expect(detail.audit.find((event: AccountAudit) => event.action === 'request.resubmit')).toMatchObject({
        detail: { previousStatus: 'rejected', previousReviewNote: '请补充团队信息', previousMessage: '初次申请说明', message: '来自研发团队' },
      })
    })

    it('validates role values, pagination and origins, and rate limits application submissions', async () => {
      const api = await admin()
      await expect(api('/api/admin/users', { query: { limit: 101 } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { projectRoles: ['root'] } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(api('/api/admin/invitations', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { name: 'Test', email: 'test@example.com', roles: [] } })).rejects.toMatchObject({ statusCode: 403 })
      const user = await register()
      const submissions = await Promise.allSettled(Array.from({ length: 8 }, () =>
        user.api('/api/account/request', { method: 'POST', body: { message: 'Same application' } })))
      expect(submissions.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
      const limited = submissions.filter((result) => result.status === 'rejected')
      expect(limited).toHaveLength(3)
      for (const result of limited) expect(result.reason).toMatchObject({ statusCode: 429 })
      const detail = await api<{ audit: AccountAudit[] }>(`/api/admin/users/${user.id}`)
      expect(detail.audit.map((event) => event.action)).toEqual(['request.update', 'request.submit'])
    })
  })

  describe('project invitations', () => {
    it('lets administrators retrieve the same link without rotating or extending the invitation', async () => {
      const login = await fetch('/api/auth/sign-in/username', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: TEST_ADMIN_PASSWORD }),
      })
      expect(login.status).toBe(200)
      const cookie = helpers.readSessionCookie(login)
      const api = client(cookie)
      const user = await register()
      const invite = await createInvite(api)
      const path = `/api/admin/invitations/${invite.invitation.id}/link`
      const before = await database((db) => db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) }))

      const response = await fetch(path, { method: 'POST', headers: { cookie } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ url: invite.url })
      expect(await api(path, { method: 'POST' })).toEqual({ url: invite.url })
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { systemRole: 'admin' } })
      const anotherAdmin = await memberLogin()
      expect(await anotherAdmin(path, { method: 'POST' })).toEqual({ url: invite.url })

      await database(async (db) => {
        expect(await db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) })).toEqual(before)
        const events = await db.select().from(auditEvents).where(eq(auditEvents.action, 'invitation.link.read'))
        expect(events).toHaveLength(3)
        for (const event of events) {
          expect(event).toMatchObject({ projectId: seedIds.projectId, targetId: invite.invitation.id, subjectUserId: user.id, detail: { email: 'new@example.com' } })
        }
        expect(events.map((event) => event.actorId)).toContain(seedIds.currentUserId)
        expect(JSON.stringify(events)).not.toContain(token(invite.url))
      })
      const list = JSON.stringify(await api('/api/admin/invitations'))
      expect(list).not.toContain(token(invite.url))
      expect(list).not.toContain('tokenHash')
      await user.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })
      await expect(api(path, { method: 'POST' })).rejects.toMatchObject({ statusCode: 410 })
    })

    it('protects link retrieval with current admin authority, trusted origins and project boundaries', async () => {
      const api = await admin()
      const invite = await createInvite(api)
      const path = `/api/admin/invitations/${invite.invitation.id}/link`
      await expect($fetch(path, { method: 'POST' })).rejects.toMatchObject({ statusCode: 401 })
      await expect(client(helpers.getMemberCookie())(path, { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
      await expect(api(path, { method: 'POST', headers: { origin: 'https://attacker.example' } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(api('/api/admin/invitations/missing/link', { method: 'POST' })).rejects.toMatchObject({ statusCode: 404 })
      await database((db) => db.update(projectInvitations).set({ projectId: seedIds.otherProjectId }).where(eq(projectInvitations.id, invite.invitation.id)))
      await expect(api(path, { method: 'POST' })).rejects.toMatchObject({ statusCode: 404 })
      await database(async (db) => {
        expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'invitation.link.read'))).toHaveLength(0)
      })
    })

    it('leaves legacy invitations usable until the administrator explicitly reissues them', async () => {
      const api = await admin()
      const invite = await createInvite(api)
      const legacyToken = randomBytes(32).toString('base64url')
      await database((db) => db.update(projectInvitations).set({ tokenHash: hashInvitationToken(legacyToken) }).where(eq(projectInvitations.id, invite.invitation.id)))
      const before = await database((db) => db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) }))
      expect(await api(`/api/admin/invitations/${invite.invitation.id}/link`, { method: 'POST' })).toEqual({ url: null })
      await database(async (db) => {
        expect(await db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) })).toEqual(before)
        expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'invitation.link.read'))).toHaveLength(0)
      })
      const preview = () => $fetch('/api/invitations/preview', { method: 'POST', body: { token: legacyToken } })
      expect(await preview()).toMatchObject({ id: invite.invitation.id, status: 'pending' })
      const replacement = await createInvite(api)
      await expect(preview()).rejects.toMatchObject({ statusCode: 410 })
      expect(await api(`/api/admin/invitations/${replacement.invitation.id}/link`, { method: 'POST' })).toEqual({ url: replacement.url })
    })

    it('joins a new account exactly once and completes its pending application without verifying email', async () => {
      const api = await admin()
      const invite = await createInvite(api)
      expect(new URL(invite.url).pathname).toBe('/invite')
      expect(token(invite.url)).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(await $fetch('/api/invitations/preview', { method: 'POST', body: { token: token(invite.url) } })).toMatchObject({ email: 'new@example.com', roles: ['developer', 'qa'] })
      const list = JSON.stringify(await api('/api/admin/invitations'))
      expect(list).not.toContain(token(invite.url))
      expect(list).not.toContain('tokenHash')
      const user = await register()
      await Promise.all([1, 2, 3].map(() => user.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })))
      expect(await getAccess(user.api)).toMatchObject({ canAccessProject: true, projectRoles: ['developer', 'qa'], request: { status: 'approved' } })
      await database(async (db) => {
        const invitation = await db.query.projectInvitations.findFirst({ where: eq(projectInvitations.id, invite.invitation.id) })
        expect(invitation).toMatchObject({ status: 'accepted', acceptedById: user.id })
        expect(invitation!.tokenHash).not.toBe(token(invite.url))
        expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'invitation.accept'))).toHaveLength(1)
        expect((await db.query.users.findFirst({ where: eq(users.id, user.id) }))?.emailVerified).toBe(false)
      })
    })

    it('requires the authenticated recipient and refuses client supplied invitation roles', async () => {
      const api = await admin()
      const invite = await createInvite(api)
      await expect($fetch('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 401 })
      const wrong = await register('wrong@example.com')
      await expect(wrong.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 403 })
      const recipient = await register()
      await expect(recipient.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url), roles: ['project_admin'] } })).rejects.toMatchObject({ statusCode: 400 })
      expect((await getAccess(recipient.api)).canAccessProject).toBe(false)
    })

    it('invalidates old links on reissue and rejects revoked and expired invitations', async () => {
      const api = await admin()
      const original = await createInvite(api)
      const replacement = await createInvite(api)
      const preview = (url: string) => $fetch('/api/invitations/preview', { method: 'POST', body: { token: token(url) } })
      await expect(preview(original.url)).rejects.toMatchObject({ statusCode: 410 })
      await api(`/api/admin/invitations/${replacement.invitation.id}/revoke`, { method: 'POST', body: {} })
      await expect(preview(replacement.url)).rejects.toMatchObject({ statusCode: 410 })
      const expired = await createInvite(api)
      await database((db) => db.update(projectInvitations).set({ createdAt: new Date(Date.now() - 8 * 86400_000), expiresAt: new Date(Date.now() - 1000) }).where(eq(projectInvitations.id, expired.invitation.id)))
      await expect(preview(expired.url)).rejects.toMatchObject({ statusCode: 410 })
      const user = await register()
      for (const invite of [original, replacement, expired]) {
        await expect(user.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 410 })
        await expect(api(`/api/admin/invitations/${invite.invitation.id}/link`, { method: 'POST' })).rejects.toMatchObject({ statusCode: 410 })
      }
      expect((await getAccess(user.api)).canAccessProject).toBe(false)
    })

    it('does not change roles if an invited applicant was already approved separately', async () => {
      const api = await admin()
      const user = await register()
      const invite = await createInvite(api, 'new@example.com', ['project_admin', 'qa'])
      const request = (await getAccess(user.api)).request!
      await api(`/api/admin/requests/${request.id}/review`, { method: 'POST', body: { decision: 'approve', roles: ['developer'] } })
      await user.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })
      expect((await getAccess(user.api)).projectRoles).toEqual(['developer'])
      await expect(createInvite(api)).rejects.toMatchObject({ statusCode: 409 })
    })

    it('cannot activate disabled accounts and revokes links when the inviter loses authority', async () => {
      const api = await admin()
      const user = await register()
      const invite = await createInvite(api)
      await api(`/api/admin/users/${user.id}/status`, { method: 'POST', body: { disabled: true, reason: '身份异常' } })
      await expect(user.api('/api/invitations/accept', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 401 })
      await expect(createInvite(api)).rejects.toMatchObject({ statusCode: 409 })
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { systemRole: 'admin' } })
      const secondAdmin = await memberLogin()
      await secondAdmin(`/api/admin/users/${seedIds.adminUserId}`, { method: 'PATCH', body: { systemRole: 'user' } })
      await expect($fetch('/api/invitations/preview', { method: 'POST', body: { token: token(invite.url) } })).rejects.toMatchObject({ statusCode: 410 })
      await expect(secondAdmin(`/api/admin/invitations/${invite.invitation.id}/link`, { method: 'POST' })).rejects.toMatchObject({ statusCode: 410 })
      await expect(api('/api/admin/users')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('audit transactions', () => {
    it('commits a business change and its audit together, then rolls both back on a later failure', async () => {
      await database(async (db) => {
        const target = { projectId: seedIds.projectId, actorId: seedIds.adminUserId, targetId: seedIds.currentUserId, subjectUserId: seedIds.currentUserId }
        const detail = { reason: '审计事务验证' }
        await db.transaction(async (tx) => {
          await tx.update(users).set({ banned: true, banReason: detail.reason }).where(eq(users.id, target.targetId))
          await writeAudit(tx, { ...target, action: 'user.disable', detail })
        })
        expect(await db.query.users.findFirst({ where: eq(users.id, target.targetId) })).toMatchObject({ banned: true, banReason: detail.reason })
        const committed = await db.select().from(auditEvents).where(eq(auditEvents.subjectUserId, target.targetId))
        expect(committed).toHaveLength(1)
        expect(committed[0]).toMatchObject({ ...target, action: 'user.disable', detail, createdAt: expect.any(Date) })
        expect(committed[0]!.id).toMatch(/^audit_[\w-]{16}$/)

        const failure = new Error('模拟后续业务失败')
        await expect(db.transaction(async (tx) => {
          await tx.update(users).set({ banned: false, banReason: null }).where(eq(users.id, target.targetId))
          await writeAudit(tx, { ...target, action: 'user.enable', detail: { reason: '' } })
          throw failure
        })).rejects.toBe(failure)
        expect(await db.query.users.findFirst({ where: eq(users.id, target.targetId) })).toMatchObject({ banned: true, banReason: detail.reason })
        expect(await db.select().from(auditEvents).where(eq(auditEvents.subjectUserId, target.targetId))).toEqual(committed)
      })
    })

    it('rolls back the business change when the audit insert fails', async () => {
      await database(async (db) => {
        await expect(db.transaction(async (tx) => {
          await tx.update(users).set({ banned: true, banReason: '不应保存' }).where(eq(users.id, seedIds.currentUserId))
          await writeAudit(tx, {
            projectId: seedIds.projectId, actorId: 'missing-audit-actor', targetId: seedIds.currentUserId, subjectUserId: seedIds.currentUserId,
            action: 'user.disable', detail: { reason: '不应保存' },
          })
        })).rejects.toMatchObject({ cause: { code: '23503' } })
        expect(await db.query.users.findFirst({ where: eq(users.id, seedIds.currentUserId) })).toMatchObject({ banned: false, banReason: null })
        expect(await db.select().from(auditEvents)).toHaveLength(0)
      })
    })
  })

  describe('account administration', () => {
    it('blocks raw auth admin routes for everyone and application admin APIs for ordinary members', async () => {
      const api = await admin()
      const member = client(helpers.getMemberCookie())
      for (const path of ['/api/admin/users', '/api/admin/requests', '/api/admin/invitations']) {
        await expect(member(path)).rejects.toMatchObject({ statusCode: 403 })
      }
      for (const path of ['create-user', 'set-role', 'update-user', 'ban-user', 'remove-user', 'impersonate-user']) {
        for (const actor of [api, member]) {
          await expect(actor(`/api/auth/admin/${path}`, { method: 'POST', body: { userId: seedIds.adminUserId, role: 'user' } })).rejects.toMatchObject({ statusCode: 404 })
        }
      }
      await expect(member(`/api/admin/users/${seedIds.adminUserId}`, { method: 'PATCH', body: { systemRole: 'user' } })).rejects.toMatchObject({ statusCode: 403 })
    })

    it('disables and restores accounts without losing history or roles, and never revives old sessions', async () => {
      const api = await admin()
      const member = client(helpers.getMemberCookie())
      const requirement = await member('/api/requirements', { method: 'POST', body: { title: 'Keep my authorship' } })
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { projectRoles: ['developer', 'qa'] } })
      await api(`/api/admin/users/${seedIds.currentUserId}/status`, { method: 'POST', body: { disabled: true, reason: '暂时离开团队' } })
      await expect(member('/api/meta')).rejects.toMatchObject({ statusCode: 401 })
      expect((await api('/api/meta')).users.some((user: any) => user.id === seedIds.currentUserId)).toBe(false)
      await expect(api('/api/requirements', { method: 'POST', body: { title: 'Invalid assignment', assigneeIds: [seedIds.currentUserId] } })).rejects.toMatchObject({ statusCode: 400 })
      await api(`/api/admin/users/${seedIds.currentUserId}/status`, { method: 'POST', body: { disabled: false } })
      await expect(member('/api/meta')).rejects.toMatchObject({ statusCode: 401 })
      const restored = await memberLogin()
      expect((await getAccess(restored)).projectRoles).toEqual(['developer', 'qa'])
      expect((await restored(`/api/requirements/${requirement.id}`)).reporter.id).toBe(seedIds.currentUserId)
      await api(`/api/admin/users/${seedIds.currentUserId}/revoke-sessions`, { method: 'POST', body: {} })
      await expect(restored('/api/meta')).rejects.toMatchObject({ statusCode: 401 })
      const detail = await api<{ audit: AccountAudit[] }>(`/api/admin/users/${seedIds.currentUserId}`)
      expect(detail.audit).toHaveLength(4)
      expect(detail.audit).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'user.update', detail: { before: { name: 'Mo Bing', systemRole: 'user', projectRoles: [] }, after: { name: 'Mo Bing', systemRole: 'user', projectRoles: ['developer', 'qa'] } } }),
        expect.objectContaining({ action: 'user.disable', detail: { reason: '暂时离开团队' } }),
        expect.objectContaining({ action: 'user.enable', detail: { reason: '' } }),
        expect.objectContaining({ action: 'user.revoke-sessions', detail: {} }),
      ]))
    })

    it('protects the last enabled admin, including concurrent disable and demotion', async () => {
      const api = await admin()
      await expect(api(`/api/admin/users/${seedIds.adminUserId}/status`, { method: 'POST', body: { disabled: true, reason: 'Test' } })).rejects.toMatchObject({ statusCode: 409 })
      await expect(api(`/api/admin/users/${seedIds.adminUserId}`, { method: 'PATCH', body: { systemRole: 'user' } })).rejects.toMatchObject({ statusCode: 409 })
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { systemRole: 'admin' } })
      const secondAdmin = await memberLogin()
      const results = await Promise.allSettled([
        api(`/api/admin/users/${seedIds.adminUserId}/status`, { method: 'POST', body: { disabled: true, reason: 'Test' } }),
        secondAdmin(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { systemRole: 'user' } }),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
      await database(async (db) => expect(await db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.banned, false)))).toHaveLength(1))
    })

    it('allows multiple business roles for project admins, limits escalation, and applies revocation immediately', async () => {
      const api = await admin()
      const member = client(helpers.getMemberCookie())
      await expect(member('/api/members')).rejects.toMatchObject({ statusCode: 403 })
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { projectRoles: ['project_admin', 'developer'] } })
      expect((await member('/api/members')).length).toBe(4)
      await member(`/api/members/${seedIds.frontendUserId}/roles`, { method: 'PUT', body: { roles: ['developer', 'qa'] } })
      await expect(member(`/api/members/${seedIds.frontendUserId}/roles`, { method: 'PUT', body: { roles: ['project_admin'] } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(member(`/api/members/${seedIds.currentUserId}/roles`, { method: 'PUT', body: { roles: [] } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(member(`/api/members/${seedIds.frontendUserId}/roles`, { method: 'PUT', body: { roles: ['qa'], systemRole: 'admin' } })).rejects.toMatchObject({ statusCode: 400 })
      await expect(member(`/api/admin/users/${seedIds.frontendUserId}`, { method: 'PATCH', body: { systemRole: 'admin' } })).rejects.toMatchObject({ statusCode: 403 })
      await expect(member(`/api/members/${seedIds.outsiderUserId}/roles`, { method: 'PUT', body: { roles: ['qa'] } })).rejects.toMatchObject({ statusCode: 404 })
      expect((await api(`/api/admin/users/${seedIds.frontendUserId}`)).user.projectRoles).toEqual(['developer', 'qa'])
      await api(`/api/admin/users/${seedIds.currentUserId}`, { method: 'PATCH', body: { projectRoles: ['developer'] } })
      await expect(member(`/api/members/${seedIds.frontendUserId}/roles`, { method: 'PUT', body: { roles: ['ops'] } })).rejects.toMatchObject({ statusCode: 403 })
    })
  })
}
