import { hashPassword } from 'better-auth/crypto'
import { createLocalAccountIssuer } from 'better-auth/db'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { ACTIVE_DOCUMENT_STATES, DOCUMENT_STATES } from '../../shared/documents/workflow'

import {
  assets,
  auditEvents,
  authAccounts,
  authRateLimits,
  authSessions,
  authVerifications,
  projectMembers,
  projectMemberRoles,
  projectAccessRequests,
  projectInvitations,
  projects,
  requirementRevisions,
  requirementAssignees,
  requirementRelations,
  requirementDrafts,
  requirementDraftAssets,
  requirementCollaborationDocuments,
  requirementStatuses,
  requirements,
  users,
} from '../../server/db/schema'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board_test'
export const TEST_USER_PASSWORD = 'test12'
export const TEST_ADMIN_PASSWORD = 'admin6'

const testPasswordHash = hashPassword(TEST_USER_PASSWORD)
const testAdminPasswordHash = hashPassword(TEST_ADMIN_PASSWORD)

export const seedIds = {
  adminUserId: 'admin',
  projectId: 'project_main',
  currentUserId: 'user_mobing',
  frontendUserId: 'user_frontend',
  designUserId: 'user_design',
  outsiderUserId: 'user_outsider',
  backlogStatusId: 'status_backlog',
  progressStatusId: 'status_progress',
  otherProjectId: 'project_other',
  otherStatusId: 'status_other',
}

function adminDatabaseUrl() {
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = '/postgres'
  return url.toString()
}

function testDatabaseName() {
  const name = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '')
  if (!name) {
    throw new Error('TEST_DATABASE_URL must include a database name')
  }
  return decodeURIComponent(name)
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

export async function prepareTestDatabase() {
  const databaseName = testDatabaseName()
  const admin = postgres(adminDatabaseUrl(), { max: 1 })

  try {
    const rows = await admin<{ exists: boolean }[]>`
      select exists(select 1 from pg_database where datname = ${databaseName}) as exists
    `

    if (!rows[0]?.exists) {
      await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`)
    }
  } finally {
    await admin.end()
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  const db = drizzle(client)

  try {
    await migrate(db, { migrationsFolder: './drizzle' })
  } finally {
    await client.end()
  }
}

export async function resetTestDatabase() {
  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  const db = drizzle(client)

  try {
    await db.execute(sql`
      truncate table
        ${auditEvents},
        ${projectInvitations},
        ${projectAccessRequests},
        ${projectMemberRoles},
        ${assets},
        ${requirementDraftAssets},
        ${requirementDrafts},
        ${requirementCollaborationDocuments},
        ${authRateLimits},
        ${authVerifications},
        ${authSessions},
        ${authAccounts},
        ${projectMembers},
        ${requirementRevisions},
        ${requirementAssignees},
        ${requirementRelations},
        ${requirements},
        ${requirementStatuses},
        ${projects},
        ${users}
      restart identity cascade
    `)

    await db.insert(users).values([
      {
        id: seedIds.adminUserId,
        name: 'admin',
        email: 'admin@requirement-board.local',
        username: 'admin',
        displayUsername: 'admin',
        role: 'admin',
        avatarColor: '#172033',
      },
      {
        id: seedIds.currentUserId,
        name: 'Mo Bing',
        email: 'mobing@example.com',
        avatarColor: '#2f6fed',
      },
      {
        id: seedIds.designUserId,
        name: 'Design',
        email: 'design@example.com',
        avatarColor: '#c15d2b',
      },
      {
        id: seedIds.frontendUserId,
        name: 'Frontend',
        email: 'frontend@example.com',
        avatarColor: '#198754',
      },
      {
        id: seedIds.outsiderUserId,
        name: 'Outsider',
        email: 'outsider@example.com',
        avatarColor: '#667085',
      },
    ])

    await db.insert(projects).values([
      {
        id: seedIds.projectId,
        name: 'Requirement Board Test',
        code: 'REQ',
        description: 'API test project',
      },
      {
        id: seedIds.otherProjectId,
        name: 'Other Project',
        code: 'OTHER',
        description: 'Cross-project constraint fixture',
      },
    ])

    await db.insert(projectMembers).values([
      { projectId: seedIds.projectId, userId: seedIds.adminUserId },
      { projectId: seedIds.projectId, userId: seedIds.currentUserId },
      { projectId: seedIds.projectId, userId: seedIds.designUserId },
      { projectId: seedIds.projectId, userId: seedIds.frontendUserId },
    ])

    await db.insert(authAccounts).values([
      {
        id: 'auth_account_test_admin',
        issuer: createLocalAccountIssuer('credential'),
        accountId: seedIds.adminUserId,
        providerId: 'credential',
        userId: seedIds.adminUserId,
        password: await testAdminPasswordHash,
      },
      {
        id: 'auth_account_test_current',
        issuer: createLocalAccountIssuer('credential'),
        accountId: seedIds.currentUserId,
        providerId: 'credential',
        userId: seedIds.currentUserId,
        password: await testPasswordHash,
      },
    ])

    await db.insert(requirementStatuses).values([
      {
        id: seedIds.backlogStatusId,
        projectId: seedIds.projectId,
        name: '待处理',
        code: 'queued',
        color: '#2f6fed',
        sortOrder: 10,
      },
      {
        id: seedIds.progressStatusId,
        projectId: seedIds.projectId,
        name: '进行中',
        code: 'doing',
        color: '#c15d2b',
        sortOrder: 20,
      },
      {
        id: seedIds.otherStatusId,
        projectId: seedIds.otherProjectId,
        name: 'Other Project Status',
        code: 'draft',
        color: '#7c3aed',
        sortOrder: 10,
      },
    ])
    await db.insert(requirementStatuses).values(ACTIVE_DOCUMENT_STATES.filter(code => !['queued', 'doing'].includes(code)).map((code, index) => ({
      id: `test_status_${code}`, projectId: seedIds.projectId, code, ...DOCUMENT_STATES[code], sortOrder: 30 + index * 10,
    })))
  } finally {
    await client.end()
  }
}
