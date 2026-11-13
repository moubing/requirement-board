import { and, asc, count, desc, eq, exists, gt, ilike, inArray, not, or, sql } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { createLocalAccountIssuer } from 'better-auth/db'
import { createError, isError } from 'h3'
import { nanoid } from 'nanoid'
import type { z } from 'zod'
import type { AccountUser, ProjectRole } from '../../shared/auth/access'
import { requestSubmissionAction } from '../../shared/auth/audit'
import type { Database, Transaction } from '../db/client'
import {
  auditEvents, authAccounts, authSessions, projectAccessRequests, projectInvitations, projectMemberRoles, projectMembers, users,
} from '../db/schema'
import type { AccountContext } from '../utils/request-context'
import type { accountStatusSchema, invitationInputSchema, managedUserCreateSchema, reviewSchema, userQuerySchema, userUpdateSchema } from '../utils/account-input'
import { DEFAULT_PROJECT_ID } from '../utils/current-user'
import { resolveAuthRuntimeConfig } from '../utils/auth-config'
import { writeAudit } from './audit'
import { deriveInvitationToken, hashInvitationToken, recoverInvitationToken } from './invitation-token'

type Reader = Pick<Database, 'select' | 'query'>
const memberWhere = (userId: string) => and(eq(projectMembers.projectId, DEFAULT_PROJECT_ID), eq(projectMembers.userId, userId))
const rolesWhere = (userId: string) => and(eq(projectMemberRoles.projectId, DEFAULT_PROJECT_ID), eq(projectMemberRoles.userId, userId))
const requestWhere = (userId: string) => and(eq(projectAccessRequests.projectId, DEFAULT_PROJECT_ID), eq(projectAccessRequests.userId, userId))
const invitationWhere = (id: string) => and(eq(projectInvitations.projectId, DEFAULT_PROJECT_ID), eq(projectInvitations.id, id))
function fail(statusCode: number, message: string): never { throw createError({ statusCode, message }) }
export const publicAccountUser = (user: AccountUser): AccountUser => ({
  id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, avatarColor: user.avatarColor,
})

export async function getProjectRoles(db: Reader, userId: string) {
  return (await db.select({ role: projectMemberRoles.role }).from(projectMemberRoles).where(rolesWhere(userId)))
    .map((row) => row.role).sort()
}

async function isMember(db: Reader, userId: string) {
  return Boolean(await db.query.projectMembers.findFirst({ where: memberWhere(userId) }))
}

export async function getAccountAccess(context: AccountContext) {
  const { db, currentUser } = context
  const [member, roles, request] = await Promise.all([
    isMember(db, currentUser.id),
    getProjectRoles(db, currentUser.id),
    db.query.projectAccessRequests.findFirst({ where: requestWhere(currentUser.id) }),
  ])
  return {
    user: publicAccountUser(currentUser),
    canAccessProject: currentUser.role === 'admin' || member,
    projectRoles: roles,
    request: request ? {
      id: request.id, status: request.status, message: request.message, reviewNote: request.reviewNote,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
    } : null,
  }
}

// 账号管理事务使用同一把锁，串行检查最后一名管理员、重复审批和邀请消费。
// 等待锁之后重新读取身份，不能沿用请求开始时的旧权限。
async function mutateAccount<T>(
  context: AccountContext,
  permission: 'account' | 'admin' | 'project-manager',
  callback: (tx: Transaction, actor: typeof users.$inferSelect) => Promise<T>,
) {
  return context.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1846200701)`)
    const actor = await tx.query.users.findFirst({ where: eq(users.id, context.currentUserId) })
    const session = await tx.query.authSessions.findFirst({
      where: and(eq(authSessions.id, context.session.session.id),
        eq(authSessions.userId, context.currentUserId), gt(authSessions.expiresAt, new Date())),
    })
    if (!session) fail(401, '登录已失效，请重新登录')
    if (!actor || actor.banned) fail(403, '账号已停用')
    if (permission === 'admin' && actor.role !== 'admin') fail(403, '需要超级管理员权限')
    if (permission === 'project-manager' && actor.role !== 'admin') {
      if (!(await getProjectRoles(tx, actor.id)).includes('project_admin')) fail(403, '需要项目管理员权限')
    }
    return callback(tx, actor)
  })
}

async function setRoles(tx: Transaction, userId: string, roles: ProjectRole[]) {
  await tx.delete(projectMemberRoles).where(rolesWhere(userId))
  if (roles.length) await tx.insert(projectMemberRoles).values(
    roles.map((role) => ({ projectId: DEFAULT_PROJECT_ID, userId, role })),
  )
}

export async function createManagedUser(context: AccountContext, input: z.output<typeof managedUserCreateSchema>) {
  try {
    // 与 Better Auth 及现有改密脚本使用相同的密码格式，不走会自动登录和提交申请的注册接口。
    const passwordHash = await hashPassword(input.password)
    return await mutateAccount(context, 'admin', async (tx, actor) => {
      const existing = await tx.query.users.findFirst({ where: or(eq(users.email, input.email), eq(users.username, input.username)) })
      if (existing) fail(409, existing.email === input.email ? '该邮箱已注册，请使用已有账号' : '该用户名已被使用，请更换用户名')
      const [user] = await tx.insert(users).values({
        id: `user_${nanoid(16)}`, name: input.name, email: input.email,
        username: input.username, displayUsername: input.username, role: input.systemRole,
        emailVerified: false, banned: false,
      }).onConflictDoNothing().returning()
      // 唯一约束也保护与自主注册并发的创建，避免产生不完整账号。
      if (!user) fail(409, '用户名或邮箱已被使用，请更换后重试')
      await tx.insert(authAccounts).values({
        id: `auth_account_${nanoid(16)}`, issuer: createLocalAccountIssuer('credential'),
        accountId: user.id, providerId: 'credential', userId: user.id, password: passwordHash,
      })
      await tx.insert(projectMembers).values({ projectId: DEFAULT_PROJECT_ID, userId: user.id })
      await setRoles(tx, user.id, input.roles)
      await tx.update(projectInvitations).set({ status: 'revoked' }).where(and(
        eq(projectInvitations.projectId, DEFAULT_PROJECT_ID), eq(projectInvitations.email, input.email), eq(projectInvitations.status, 'pending'),
      ))
      await writeAudit(tx, {
        projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: user.id, subjectUserId: user.id,
        action: 'user.create', detail: {
          name: user.name, username: input.username, email: user.email,
          systemRole: input.systemRole, projectRoles: input.roles,
        },
      })
      return { user: publicAccountUser(user) }
    })
  } catch (error) {
    if (isError(error)) throw error
    // 数据库异常可能携带凭证 SQL 参数，不向客户端或普通错误日志透传。
    fail(500, '创建用户失败，请稍后重试')
  }
}

async function revokeInvitations(tx: Transaction, invitedById: string) {
  await tx.update(projectInvitations).set({ status: 'revoked' })
    .where(and(eq(projectInvitations.invitedById, invitedById), eq(projectInvitations.status, 'pending')))
}

async function ensureAnotherAdmin(tx: Transaction, target: typeof users.$inferSelect) {
  if (target.role !== 'admin' || target.banned) return
  const [row] = await tx.select({ value: count() }).from(users)
    .where(and(eq(users.role, 'admin'), eq(users.banned, false)))
  if (!row || row.value <= 1) fail(409, '至少需要保留一名启用的超级管理员')
}

export async function submitAccessRequest(context: AccountContext, message: string) {
  return mutateAccount(context, 'account', async (tx, actor) => {
    if (actor.role === 'admin' || await isMember(tx, actor.id)) fail(409, '你已经可以访问项目')
    const previous = await tx.query.projectAccessRequests.findFirst({ where: requestWhere(actor.id) })
    if (previous?.status === 'pending' && previous.message === message) return { id: previous.id }
    const id = previous?.id ?? `request_${nanoid(12)}`
    await tx.insert(projectAccessRequests).values({
      id, projectId: DEFAULT_PROJECT_ID, userId: actor.id, message,
    }).onConflictDoUpdate({
      target: [projectAccessRequests.projectId, projectAccessRequests.userId],
      set: { status: 'pending', message, reviewNote: '', reviewedAt: null, reviewedById: null, updatedAt: new Date() },
    })
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: actor.id,
      action: requestSubmissionAction(previous?.status ?? null),
      detail: {
        previousStatus: previous?.status ?? null, previousReviewNote: previous?.reviewNote ?? '',
        previousMessage: previous?.message ?? '', message,
      },
    })
    return { id }
  })
}

export async function reviewAccessRequest(context: AccountContext, id: string, input: z.output<typeof reviewSchema>) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const request = await tx.query.projectAccessRequests.findFirst({
      where: and(eq(projectAccessRequests.id, id), eq(projectAccessRequests.projectId, DEFAULT_PROJECT_ID)),
    })
    if (!request) fail(404, '申请不存在')
    const status = input.decision === 'approve' ? 'approved' : 'rejected'
    if (request.status === status) return { status }
    if (request.status !== 'pending') fail(409, '申请已经处理，请刷新后重试')
    const target = await tx.query.users.findFirst({ where: eq(users.id, request.userId) })
    if (!target || target.banned) fail(409, '请先恢复账号，再处理申请')
    if (await isMember(tx, target.id)) fail(409, '该用户已经是项目成员')
    if (status === 'approved') {
      await tx.insert(projectMembers).values({ projectId: DEFAULT_PROJECT_ID, userId: target.id })
      await setRoles(tx, target.id, input.roles)
    }
    await tx.update(projectAccessRequests).set({
      status, reviewNote: input.note, reviewedById: actor.id, reviewedAt: new Date(), updatedAt: new Date(),
    }).where(eq(projectAccessRequests.id, id))
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: target.id,
      action: `request.${input.decision}`, detail: { note: input.note, roles: status === 'approved' ? input.roles : [] },
    })
    return { status }
  })
}

export function invitationView(row: typeof projectInvitations.$inferSelect) {
  return {
    id: row.id, name: row.name, email: row.email, roles: row.roles,
    status: row.status === 'pending' && row.expiresAt <= new Date() ? 'expired' as const : row.status,
    createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
  }
}

async function findInvitation(db: Reader, token: string) {
  const invitation = await db.query.projectInvitations.findFirst({
    where: and(eq(projectInvitations.tokenHash, hashInvitationToken(token)), eq(projectInvitations.projectId, DEFAULT_PROJECT_ID)),
  })
  if (!invitation) fail(404, '邀请不存在或链接无效')
  return invitation
}

async function assertUsableInvitation(db: Reader, invitation: typeof projectInvitations.$inferSelect) {
  if (invitation.status !== 'pending' || invitation.expiresAt <= new Date()) fail(410, '邀请已失效，请联系管理员重新邀请')
  const inviter = await db.query.users.findFirst({ where: eq(users.id, invitation.invitedById) })
  if (!inviter || inviter.banned || inviter.role !== 'admin') fail(410, '邀请已失效，请联系管理员')
}

export async function previewInvitation(db: Database, token: string) {
  const invitation = await findInvitation(db, token)
  await assertUsableInvitation(db, invitation)
  return invitationView(invitation)
}

export async function createInvitation(context: AccountContext, input: z.output<typeof invitationInputSchema>) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const target = await tx.query.users.findFirst({ where: eq(users.email, input.email) })
    if (target?.banned) fail(409, '该账号已停用，请先恢复账号')
    if (target && await isMember(tx, target.id)) fail(409, '该账号已经是项目成员，请直接修改项目角色')
    await tx.update(projectInvitations).set({ status: 'revoked' }).where(and(
      eq(projectInvitations.projectId, DEFAULT_PROJECT_ID), eq(projectInvitations.email, input.email),
      eq(projectInvitations.status, 'pending'),
    ))
    const config = resolveAuthRuntimeConfig()
    const id = `invite_${nanoid(12)}`
    const token = deriveInvitationToken({ id, projectId: DEFAULT_PROJECT_ID }, config.secret)
    const [invitation] = await tx.insert(projectInvitations).values({
      id, projectId: DEFAULT_PROJECT_ID, ...input,
      tokenHash: hashInvitationToken(token), invitedById: actor.id, expiresAt: new Date(Date.now() + 7 * 86400_000),
    }).returning()
    if (!invitation) fail(500, '创建邀请失败')
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: invitation.id, subjectUserId: target?.id ?? null,
      action: 'invitation.create', detail: { email: input.email, roles: input.roles },
    })
    return { invitation: invitationView(invitation), url: `${config.baseURL}/invite#${token}` }
  })
}

export async function readInvitationLink(context: AccountContext, id: string) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const invitation = await tx.query.projectInvitations.findFirst({ where: invitationWhere(id) })
    if (!invitation) fail(404, '邀请不存在')
    await assertUsableInvitation(tx, invitation)
    const config = resolveAuthRuntimeConfig()
    const token = recoverInvitationToken(invitation, config.secret)
    if (!token) return { url: null }
    const target = await tx.query.users.findFirst({ where: eq(users.email, invitation.email) })
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: target?.id ?? null,
      action: 'invitation.link.read', detail: { email: invitation.email },
    })
    return { url: `${config.baseURL}/invite#${token}` }
  })
}

export async function revokeInvitation(context: AccountContext, id: string) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const invitation = await tx.query.projectInvitations.findFirst({ where: invitationWhere(id) })
    if (!invitation) fail(404, '邀请不存在')
    if (invitation.status === 'revoked') return { success: true }
    if (invitation.status === 'accepted') fail(409, '该邀请已经被接受')
    await tx.update(projectInvitations).set({ status: 'revoked' }).where(invitationWhere(id))
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: null,
      action: 'invitation.revoke', detail: { email: invitation.email },
    })
    return { success: true }
  })
}

export async function acceptInvitation(context: AccountContext, token: string) {
  return mutateAccount(context, 'account', async (tx, actor) => {
    const invitation = await findInvitation(tx, token)
    if (invitation.status === 'accepted' && invitation.acceptedById === actor.id) return { success: true }
    await assertUsableInvitation(tx, invitation)
    if (actor.email.trim().toLowerCase() !== invitation.email) fail(403, '请使用受邀邮箱对应的账号接受邀请')
    const existingMember = await isMember(tx, actor.id)
    if (!existingMember) {
      await tx.insert(projectMembers).values({ projectId: DEFAULT_PROJECT_ID, userId: actor.id })
      await setRoles(tx, actor.id, invitation.roles)
      const review = { status: 'approved' as const, reviewNote: '通过管理员邀请加入', reviewedById: invitation.invitedById, reviewedAt: new Date(), updatedAt: new Date() }
      await tx.insert(projectAccessRequests).values({
        id: `request_${nanoid(12)}`, projectId: DEFAULT_PROJECT_ID, userId: actor.id, ...review,
      }).onConflictDoUpdate({ target: [projectAccessRequests.projectId, projectAccessRequests.userId], set: review })
    }
    await tx.update(projectInvitations).set({ status: 'accepted', acceptedById: actor.id, acceptedAt: new Date() })
      .where(invitationWhere(invitation.id))
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: invitation.id, subjectUserId: actor.id,
      action: 'invitation.accept', detail: { roles: invitation.roles, existingMember },
    })
    return { success: true }
  })
}

export async function updateManagedUser(context: AccountContext, id: string, input: z.output<typeof userUpdateSchema>) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, id) })
    if (!target) fail(404, '用户不存在')
    if ((input.projectRoles || input.systemRole) && !(await isMember(tx, id))) fail(409, '请先批准该用户加入项目')
    const previousRoles = await getProjectRoles(tx, id)
    if (input.systemRole && input.systemRole !== target.role) {
      if (input.systemRole !== 'admin') {
        await ensureAnotherAdmin(tx, target)
        await revokeInvitations(tx, id)
      }
      await tx.delete(authSessions).where(eq(authSessions.userId, id))
    }
    await tx.update(users).set({ name: input.name ?? target.name, role: input.systemRole ?? target.role }).where(eq(users.id, id))
    if (input.projectRoles) await setRoles(tx, id, input.projectRoles)
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: id,
      action: 'user.update',
      detail: {
        before: { name: target.name, systemRole: target.role, projectRoles: previousRoles },
        after: { name: input.name ?? target.name, systemRole: input.systemRole ?? target.role, projectRoles: input.projectRoles ?? previousRoles },
      },
    })
    return { success: true }
  })
}

export async function changeAccountStatus(context: AccountContext, id: string, input: z.output<typeof accountStatusSchema>) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, id) })
    if (!target) fail(404, '用户不存在')
    if (target.banned === input.disabled) return { success: true }
    if (input.disabled) {
      await ensureAnotherAdmin(tx, target)
      await revokeInvitations(tx, id)
    }
    await tx.update(users).set({
      banned: input.disabled, banReason: input.disabled ? input.reason : null, banExpires: null,
    }).where(eq(users.id, id))
    // 恢复时也清除会话，避免停用期间的在途登录产生可复活的旧会话。
    await tx.delete(authSessions).where(eq(authSessions.userId, id))
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: id,
      action: input.disabled ? 'user.disable' : 'user.enable', detail: { reason: input.reason },
    })
    return { success: true }
  })
}

export async function revokeAccountSessions(context: AccountContext, id: string) {
  return mutateAccount(context, 'admin', async (tx, actor) => {
    if (!(await tx.query.users.findFirst({ where: eq(users.id, id) }))) fail(404, '用户不存在')
    await tx.delete(authSessions).where(eq(authSessions.userId, id))
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: id,
      action: 'user.revoke-sessions', detail: {},
    })
    return { success: true }
  })
}

export async function updateMemberRoles(context: AccountContext, id: string, roles: ProjectRole[]) {
  return mutateAccount(context, 'project-manager', async (tx, actor) => {
    if (!(await isMember(tx, id))) fail(404, '项目成员不存在')
    const previous = await getProjectRoles(tx, id)
    if (actor.role !== 'admin' && previous.includes('project_admin') !== roles.includes('project_admin')) {
      fail(403, '项目管理员资格只能由超级管理员调整')
    }
    await setRoles(tx, id, roles)
    await writeAudit(tx, {
      projectId: DEFAULT_PROJECT_ID, actorId: actor.id, targetId: id, subjectUserId: id,
      action: 'member.roles', detail: { before: previous, after: roles },
    })
    return { success: true }
  })
}

export async function listManagedUsers(db: Database, query: z.output<typeof userQuerySchema>) {
  const membership = exists(db.select({ id: projectMembers.userId }).from(projectMembers).where(and(
    eq(projectMembers.userId, users.id), eq(projectMembers.projectId, DEFAULT_PROJECT_ID),
  )))
  const requestStatus = (status: 'pending' | 'rejected') => exists(
    db.select({ id: projectAccessRequests.id }).from(projectAccessRequests).where(and(
      eq(projectAccessRequests.userId, users.id), eq(projectAccessRequests.projectId, DEFAULT_PROJECT_ID),
      eq(projectAccessRequests.status, status),
    )),
  )
  const active = or(membership, eq(users.role, 'admin'))
  const conditions = [
    query.search ? or(ilike(users.name, `%${query.search}%`), ilike(users.email, `%${query.search}%`), ilike(users.username, `%${query.search}%`)) : undefined,
    query.role ? exists(db.select({ id: projectMemberRoles.userId }).from(projectMemberRoles).where(and(
      eq(projectMemberRoles.userId, users.id), eq(projectMemberRoles.projectId, DEFAULT_PROJECT_ID), eq(projectMemberRoles.role, query.role),
    ))) : undefined,
    query.status === 'disabled' ? eq(users.banned, true) : query.status ? eq(users.banned, false) : undefined,
    query.status === 'active' ? active : ['pending', 'rejected', 'unjoined'].includes(query.status) ? not(active!) : undefined,
    query.status === 'pending' || query.status === 'rejected' ? requestStatus(query.status) : undefined,
    query.status === 'unjoined' ? and(not(requestStatus('pending')), not(requestStatus('rejected'))) : undefined,
  ]
  const where = and(...conditions)
  const [rows, totals] = await Promise.all([
    db.select().from(users).where(where).orderBy(desc(users.createdAt), asc(users.id))
      .limit(query.limit).offset((query.page - 1) * query.limit),
    db.select({ value: count() }).from(users).where(where),
  ])
  return { items: await decorateUsers(db, rows), total: totals[0]?.value ?? 0, page: query.page, limit: query.limit }
}

async function decorateUsers(db: Database, rows: (typeof users.$inferSelect)[]) {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id)
  const [members, roles, requests] = await Promise.all([
    db.select().from(projectMembers).where(and(eq(projectMembers.projectId, DEFAULT_PROJECT_ID), inArray(projectMembers.userId, ids))),
    db.select().from(projectMemberRoles).where(and(eq(projectMemberRoles.projectId, DEFAULT_PROJECT_ID), inArray(projectMemberRoles.userId, ids))),
    db.select().from(projectAccessRequests).where(and(eq(projectAccessRequests.projectId, DEFAULT_PROJECT_ID), inArray(projectAccessRequests.userId, ids))),
  ])
  return rows.map((row) => ({
    ...publicAccountUser(row), banned: row.banned, banReason: row.banReason, createdAt: row.createdAt.toISOString(),
    isMember: members.some((member) => member.userId === row.id),
    projectRoles: roles.filter((role) => role.userId === row.id).map((role) => role.role).sort(),
    requestStatus: requests.find((request) => request.userId === row.id)?.status ?? null,
  }))
}

export async function managedUserDetail(db: Database, id: string) {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) })
  if (!row) fail(404, '用户不存在')
  const [user] = await decorateUsers(db, [row])
  const events = await db.select({
    id: auditEvents.id, action: auditEvents.action, detail: auditEvents.detail,
    createdAt: auditEvents.createdAt, actorName: users.name,
  }).from(auditEvents).innerJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.subjectUserId, id), eq(auditEvents.projectId, DEFAULT_PROJECT_ID)))
    .orderBy(desc(auditEvents.createdAt)).limit(30)
  return { user: user!, audit: events }
}

export async function listAccessRequests(db: Database, page: number, limit: number) {
  const where = eq(projectAccessRequests.projectId, DEFAULT_PROJECT_ID)
  const [rows, totals] = await Promise.all([
    db.select({ request: projectAccessRequests, user: users }).from(projectAccessRequests)
      .innerJoin(users, eq(users.id, projectAccessRequests.userId)).where(where)
      .orderBy(asc(projectAccessRequests.status), desc(projectAccessRequests.updatedAt))
      .limit(limit).offset((page - 1) * limit),
    db.select({ value: count() }).from(projectAccessRequests).where(where),
  ])
  return { items: rows.map(({ request, user }) => ({ ...request, user: publicAccountUser(user) })), total: totals[0]?.value ?? 0, page, limit }
}

export async function listInvitations(db: Database, page: number, limit: number) {
  const where = eq(projectInvitations.projectId, DEFAULT_PROJECT_ID)
  const [rows, totals] = await Promise.all([
    db.select().from(projectInvitations).where(where).orderBy(desc(projectInvitations.createdAt)).limit(limit).offset((page - 1) * limit),
    db.select({ value: count() }).from(projectInvitations).where(where),
  ])
  return { items: rows.map(invitationView), total: totals[0]?.value ?? 0, page, limit }
}

export async function listProjectMembers(db: Database) {
  const rows = await db.select({ user: users }).from(users)
    .innerJoin(projectMembers, and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, DEFAULT_PROJECT_ID)))
    .orderBy(asc(users.name))
  return decorateUsers(db, rows.map((row) => row.user))
}
