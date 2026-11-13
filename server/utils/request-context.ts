import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'

import type { Database } from '../db/client'
import { useDatabase } from '../db/client'
import { projectMemberRoles, projectMembers, projects, users } from '../db/schema'
import { useAuth } from './auth'
import { resolveAuthRuntimeConfig } from './auth-config'
import { DEFAULT_PROJECT_ID } from './current-user'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function assertTrustedMutationOrigin(event: H3Event) {
  if (SAFE_METHODS.has(event.method.toUpperCase())) return

  const originHeader = event.headers.get('origin')
  if (!originHeader) return

  let origin: string
  try {
    origin = new URL(originHeader).origin
  } catch {
    throw createError({ statusCode: 403, statusMessage: 'Untrusted request origin' })
  }

  if (!resolveAuthRuntimeConfig().trustedOrigins.includes(origin)) {
    throw createError({ statusCode: 403, statusMessage: 'Untrusted request origin' })
  }
}

export async function findProjectMembership(db: Database, projectId: string, userId: string) {
  return db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.userId, userId),
    ),
    with: {
      project: true,
      user: true,
    },
  })
}

export async function requireAccountContext(event: H3Event) {
  assertTrustedMutationOrigin(event)
  return requireAccountContextFromHeaders(event.headers)
}

export async function requireAccountContextFromHeaders(headers: Headers) {
  const session = await useAuth().api.getSession({ headers })
  if (!session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  const db = useDatabase()
  const currentUser = await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
  if (!currentUser || currentUser.banned) {
    throw createError({ statusCode: 403, message: '账号已停用' })
  }
  return { db, session, currentUser, currentUserId: currentUser.id }
}

export type AccountContext = Awaited<ReturnType<typeof requireAccountContext>>

export async function requireSystemAdminContext(event: H3Event) {
  const context = await requireAccountContext(event)
  if (context.currentUser.role !== 'admin') {
    throw createError({ statusCode: 403, message: '需要超级管理员权限' })
  }
  return context
}

export async function requireAppContext(event: H3Event) {
  return requireProjectContext(await requireAccountContext(event))
}

export async function requireProjectContext<T extends Pick<AccountContext, 'db' | 'currentUser' | 'currentUserId'>>(context: T) {
  const { db, currentUser, currentUserId } = context
  const membership = await findProjectMembership(db, DEFAULT_PROJECT_ID, currentUserId)
  if (!membership && currentUser.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Project access denied' })
  }
  const project = membership?.project
    ?? await db.query.projects.findFirst({ where: eq(projects.id, DEFAULT_PROJECT_ID) })
  if (!project) throw createError({ statusCode: 503, message: '项目尚未初始化' })
  const roles = await db.select({ role: projectMemberRoles.role }).from(projectMemberRoles)
    .where(and(eq(projectMemberRoles.projectId, DEFAULT_PROJECT_ID), eq(projectMemberRoles.userId, currentUserId)))

  return {
    ...context,
    project,
    projectId: DEFAULT_PROJECT_ID,
    projectRoles: roles.map((row) => row.role),
  }
}
