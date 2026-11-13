import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../../server/db/client'
import { registerAccountTests } from './accounts.cases'
import { registerDraftTests } from './drafts.cases'
import { registerCollaborationTests } from './collaboration.cases'
import { registerAttributionTests } from './attribution.cases'
import { registerAgentSuggestionTests } from './agent-suggestions.cases'
import { registerAgentManagementTests } from './agent-management.cases'
import { registerAgentToolsTests } from './agent-tools.cases'
import { registerAnnotationObjectTests } from './annotation-objects.cases'
import { registerSeedTests } from './seeds.cases'
import { registerDocumentTests } from './documents.cases'
import { registerRelationTests } from './relations.cases'
import { registerRequirementQueryTests } from './requirement-queries.cases'
import { registerAgentTokenPageTests } from './agent-token-pages.cases'
import { registerAgentDiscoveryTests } from './agent-discovery.cases'
import { registerRequirementMilestoneTests } from './requirement-milestones.cases'
import { registerWorkbenchStatisticsTests } from './workbench-statistics.cases'
import { registerWorkbenchHomeTests } from './workbench-home.cases'
import { registerTaskListTests } from './task-list.cases'
import { registerDetailsTests } from './details.cases'
import { assets, requirementRevisions, requirements, users } from '../../server/db/schema'
import { garbageCollectAssets } from '../../server/services/asset-gc'
import { createAssetStorage } from '../../server/services/asset-storage'
import { resolveAssetUploadDir } from '../../server/utils/asset-upload-dir'
import type { RichTextDocument } from '../../shared/editor/document'
import {
  prepareTestDatabase,
  resetTestDatabase,
  seedIds,
  TEST_ADMIN_PASSWORD,
  TEST_DATABASE_URL,
  TEST_USER_PASSWORD,
} from '../setup/db'

const rootDir = process.cwd()
const uploadsDir = resolveAssetUploadDir({
  cwd: rootDir,
  configuredDir: await mkdtemp(join(tmpdir(), 'requirement-board-api-')),
  nodeEnv: 'test',
})
const previousAssetUploadDir = process.env.ASSET_UPLOAD_DIR
const previousAssetStorageDriver = process.env.ASSET_STORAGE_DRIVER
const previousBetterAuthSecret = process.env.BETTER_AUTH_SECRET
const previousBetterAuthUrl = process.env.BETTER_AUTH_URL
const previousBetterAuthCookiePrefix = process.env.BETTER_AUTH_COOKIE_PREFIX
const testBetterAuthSecret = 'requirement-board-api-test-secret-123456789'
const testBetterAuthUrl = 'http://localhost:3000'
const testBetterAuthCookiePrefix = 'rb-api-test'

process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.ASSET_STORAGE_DRIVER = 'local'
process.env.ASSET_UPLOAD_DIR = uploadsDir
process.env.BETTER_AUTH_SECRET = testBetterAuthSecret
process.env.BETTER_AUTH_URL = testBetterAuthUrl
process.env.BETTER_AUTH_COOKIE_PREFIX = testBetterAuthCookiePrefix

function safeTestUploadsDir() {
  return resolveAssetUploadDir({
    cwd: rootDir,
    configuredDir: uploadsDir,
    nodeEnv: 'test',
  })
}

async function resetTestUploads() {
  const safeDir = safeTestUploadsDir()
  await rm(safeDir, { recursive: true, force: true })
  await mkdir(safeDir, { recursive: true })
}

function restoreTestEnvironment() {
  if (previousAssetUploadDir === undefined) {
    delete process.env.ASSET_UPLOAD_DIR
  } else {
    process.env.ASSET_UPLOAD_DIR = previousAssetUploadDir
  }

  if (previousAssetStorageDriver === undefined) {
    delete process.env.ASSET_STORAGE_DRIVER
  } else {
    process.env.ASSET_STORAGE_DRIVER = previousAssetStorageDriver
  }

  if (previousBetterAuthSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET
  } else {
    process.env.BETTER_AUTH_SECRET = previousBetterAuthSecret
  }

  if (previousBetterAuthUrl === undefined) {
    delete process.env.BETTER_AUTH_URL
  } else {
    process.env.BETTER_AUTH_URL = previousBetterAuthUrl
  }
  if (previousBetterAuthCookiePrefix === undefined) {
    delete process.env.BETTER_AUTH_COOKIE_PREFIX
  } else {
    process.env.BETTER_AUTH_COOKIE_PREFIX = previousBetterAuthCookiePrefix
  }
}

try {
  await prepareTestDatabase()
  await setup({
    rootDir,
    browser: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: testBetterAuthSecret,
      BETTER_AUTH_URL: testBetterAuthUrl,
      BETTER_AUTH_COOKIE_PREFIX: testBetterAuthCookiePrefix,
      ASSET_STORAGE_DRIVER: 'local',
      ASSET_UPLOAD_DIR: uploadsDir,
    },
  })
} catch (error) {
  try {
    await rm(safeTestUploadsDir(), { recursive: true, force: true })
  } finally {
    restoreTestEnvironment()
  }
  throw error
}

let authCookie = ''

function readSessionCookie(response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const setCookieValues = getSetCookie?.call(response.headers) ?? [response.headers.get('set-cookie') ?? '']
  const cookie = setCookieValues
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (!cookie) throw new Error('Sign-in response did not set a session cookie')
  return cookie
}

async function signIn() {
  const response = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: 'mobing@example.com',
      password: TEST_USER_PASSWORD,
      rememberMe: true,
    }),
  })
  if (!response.ok) {
    throw new Error(`Sign-in failed with HTTP ${response.status}`)
  }

  authCookie = readSessionCookie(response)
}

async function apiFetch<T = unknown>(request: string, options: Record<string, any> = {}) {
  const headers = new Headers(options.headers as HeadersInit | undefined)
  if (!headers.has('x-rb-document-schema')) headers.set('x-rb-document-schema', '3')
  if (!headers.has('x-rb-document-capabilities')) headers.set('x-rb-document-capabilities', 'task_lists,details')
  headers.set('cookie', authCookie)
  return $fetch<T>(request, { ...options, headers })
}

beforeEach(async () => {
  await resetTestDatabase()
  await resetTestUploads()
  await signIn()
})

afterAll(async () => {
  try {
    await rm(safeTestUploadsDir(), { recursive: true, force: true })
  } finally {
    restoreTestEnvironment()
  }
})

function requirementDoc(text: string, diffId = 'body'): RichTextDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { diffId },
        content: [{ type: 'text', text }],
      },
    ],
  }
}

async function createRequirement(title = 'Keyboard shortcut support') {
  return apiFetch<Record<string, any>>('/api/requirements', {
    method: 'POST',
    body: {
      title,
      priority: 'high',
      assigneeIds: [seedIds.frontendUserId],
    },
  })
}

async function uploadImage(requirementId: string, fileName: string) {
  const form = new FormData()
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  form.append('file', new Blob([pngBytes], { type: 'image/png' }), fileName)

  return apiFetch<Record<string, any>>('/api/assets/upload', {
    method: 'POST',
    query: { requirementId },
    body: form,
  })
}

describe('authentication', () => {
  it('renders the initial shell with the confirmed route identity and sidebar preference', async () => {
    const member = await apiFetch<string>('/')
    expect(member).toContain('data-sidebar-open="true"')
    expect(member).toContain('class="app-user-menu"')
    expect(member).not.toContain('class="app-header__login"')
    const collapsed = await fetch('/', { headers: { cookie: `${authCookie}; rb-sidebar-open=false` } })
    expect(await collapsed.text()).toContain('data-sidebar-open="false"')
    const guest = await fetch('/', { redirect: 'manual' })
    expect(guest.status).toBe(302)
    const destination = new URL(guest.headers.get('location')!, 'http://localhost')
    expect(destination.pathname).toBe('/login')
    expect(destination.searchParams.get('redirect')).toBe('/')
    const login = await fetch('/login')
    const html = await login.text()
    expect(html).toContain('data-sidebar-open="false"')
    expect(html).not.toContain('class="app-user-menu"')
  })

  it('uses the configured Cookie namespace and rejects a session under another environment name', async () => {
    expect(authCookie).toContain(`${testBetterAuthCookiePrefix}.session_token=`)
    await expect(apiFetch('/api/meta')).resolves.toBeDefined()
    await expect($fetch('/api/meta', {
      headers: { cookie: authCookie.replaceAll(`${testBetterAuthCookiePrefix}.`, 'rb-other.') },
    })).rejects.toMatchObject({ statusCode: 401 })
  })
  it('keeps health public and protects business APIs', async () => {
    await expect($fetch('/api/health')).resolves.toEqual({ status: 'ok' })
    await expect($fetch('/api/meta')).rejects.toMatchObject({ statusCode: 401 })
    expect((await apiFetch<Record<string, any>>('/api/meta')).currentUserId).toBe(seedIds.currentUserId)
  })

  it('rejects state-changing requests from untrusted browser origins', async () => {
    await expect(apiFetch('/api/requirements', {
      method: 'POST', headers: { origin: 'https://attacker.example.com' }, body: { title: 'Cross-site request' },
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects invalid credentials', async () => {
    await expect($fetch('/api/auth/sign-in/email', {
      method: 'POST', body: { email: 'mobing@example.com', password: 'wrong-password-value' },
    })).rejects.toMatchObject({ statusCode: 401 })
  })

  it('revokes the database session on sign-out', async () => {
    await apiFetch('/api/auth/sign-out', { method: 'POST', body: {} })
    await expect(apiFetch('/api/meta')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('blocks disabled users from creating or using sessions', async () => {
    const { client, db } = createDatabase(TEST_DATABASE_URL)
    try { await db.update(users).set({ banned: true }).where(eq(users.id, seedIds.currentUserId)) }
    finally { await client.end() }
    await expect(apiFetch('/api/meta')).rejects.toMatchObject({ statusCode: 403 })
    await expect($fetch('/api/auth/sign-in/email', {
      method: 'POST', body: { email: 'mobing@example.com', password: TEST_USER_PASSWORD },
    })).rejects.toMatchObject({ statusCode: 403 })
  })
})

registerAccountTests({ readSessionCookie, getMemberCookie: () => authCookie })
registerDraftTests({ apiFetch, createRequirement, readSessionCookie, uploadsDir })
registerCollaborationTests({ apiFetch, createRequirement })
registerAttributionTests({ apiFetch, createRequirement, readSessionCookie })
registerAgentSuggestionTests({ apiFetch, createRequirement, readSessionCookie })
registerAgentManagementTests({ apiFetch, createRequirement })
registerAgentToolsTests({ apiFetch, uploadsDir })
registerAnnotationObjectTests({ apiFetch, createRequirement, uploadsDir })
registerSeedTests({ apiFetch, createRequirement, readSessionCookie })
registerDocumentTests({ apiFetch, readSessionCookie, uploadsDir })
registerRelationTests({ apiFetch, createRequirement })
registerRequirementQueryTests({ apiFetch })
registerAgentTokenPageTests({ apiFetch })
registerAgentDiscoveryTests({ apiFetch })
registerRequirementMilestoneTests({ apiFetch })
registerWorkbenchStatisticsTests({ apiFetch })
registerWorkbenchHomeTests({ apiFetch })
registerTaskListTests({ apiFetch, createRequirement })
registerDetailsTests({ apiFetch, createRequirement })

describe('requirements API', () => {
  it('缓存版本命中只返回新属性，版本变化返回正文，授权仍先于缓存判断', async () => {
    const created = await createRequirement('缓存详情')
    const initial = await apiFetch<Record<string, any>>(`/api/requirements/${created.id}`)
    const knownRevisionId = initial.currentRevision.id
    await apiFetch(`/api/requirements/${created.id}`, { method: 'PATCH', body: { title: '最新属性', priority: 'low' } })
    const cached = await apiFetch<Record<string, any>>(`/api/requirements/${created.id}`, { query: { knownRevisionId } })
    expect(cached).toMatchObject({ title: '最新属性', priority: 'low', currentRevisionUnchanged: true, currentRevisionId: knownRevisionId })
    expect(cached).not.toHaveProperty('currentRevision')
    await apiFetch(`/api/requirements/${created.id}/revisions`, { method: 'POST', body: { title: '最新属性', contentJson: requirementDoc('第二版', 'p_second'), changeNote: '' } })
    const changed = await apiFetch<Record<string, any>>(`/api/requirements/${created.id}`, { query: { knownRevisionId } })
    expect(changed.currentRevision.id).not.toBe(knownRevisionId)
    expect(changed.currentRevision.contentJson).toBeDefined()
    expect(changed).not.toHaveProperty('currentRevisionUnchanged')
    await expect($fetch(`/api/requirements/${created.id}`, { query: { knownRevisionId } })).rejects.toMatchObject({ statusCode: 401 })
    const { db, client } = createDatabase(TEST_DATABASE_URL)
    try {
      await db.insert(requirements).values({ id: 'req_other_cached', key: 'OTHER-CACHE', title: '不可访问', projectId: seedIds.otherProjectId,
        statusId: seedIds.otherStatusId, reporterId: seedIds.currentUserId })
      await db.insert(requirementRevisions).values({ id: 'rev_other_cached', requirementId: 'req_other_cached', version: 1, title: '不可访问',
        contentJson: requirementDoc('其他项目正文'), contentText: '其他项目正文', changeNote: '', authorId: seedIds.currentUserId })
    }
    finally { await client.end() }
    await expect(apiFetch('/api/requirements/req_other_cached', { query: { knownRevisionId: 'rev_other_cached' } })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('creates, lists, reads, and patches a requirement', async () => {
    const meta = await apiFetch<Record<string, any>>('/api/meta')
    expect(meta.project.id).toBe(seedIds.projectId)
    expect(meta.statuses).toHaveLength(8)
    expect(meta.users).toHaveLength(4)

    const created = await createRequirement()

    expect(created.id).toMatch(/^req_/)
    expect(created.key).toBe('REQ-1')
    expect(created.title).toBe('Keyboard shortcut support')
    expect(created.status.id).toBe(seedIds.backlogStatusId)
    expect(created.assigneeIds).toEqual([seedIds.frontendUserId])
    expect(created.assignees[0].id).toBe(seedIds.frontendUserId)
    expect(created.reporter.id).toBe(seedIds.currentUserId)
    expect(created.priority).toBe('high')

    const rows = await apiFetch<{ items: Array<Record<string, any>>; total: number }>('/api/requirements')
    expect(rows.total).toBe(1)
    expect(rows.items[0].id).toBe(created.id)

    const patched = await apiFetch<Record<string, any>>(`/api/requirements/${created.id}`, {
      method: 'PATCH',
      body: {
        title: 'Keyboard shortcut support v2',
        statusId: seedIds.progressStatusId,
        assigneeIds: [seedIds.designUserId],
        priority: 'low',
      },
    })

    expect(patched.title).toBe('Keyboard shortcut support v2')
    expect(patched.status.id).toBe(seedIds.progressStatusId)
    expect(patched.assigneeIds).toEqual([seedIds.designUserId])
    expect(patched.assignees[0].id).toBe(seedIds.designUserId)
    expect(patched.priority).toBe('low')

    const detail = await apiFetch<Record<string, any>>(`/api/requirements/${created.id}`)
    expect(detail.currentRevision.version).toBe(1)
    expect(detail.currentRevision.contentJson.type).toBe('doc')
  })

  it('rejects statuses from another project when creating or patching a requirement', async () => {
    await expect(
      apiFetch('/api/requirements', {
        method: 'POST',
        body: {
          title: 'Cross-project create',
          statusId: seedIds.otherStatusId,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    const requirement = await createRequirement('Cross-project patch')
    await expect(
      apiFetch(`/api/requirements/${requirement.id}`, {
        method: 'PATCH',
        body: { statusId: seedIds.otherStatusId },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    const unchanged = await apiFetch<Record<string, any>>(`/api/requirements/${requirement.id}`)
    expect(unchanged.status.id).toBe(seedIds.backlogStatusId)
  })

  it('rejects assignees outside the current project', async () => {
    await expect(
      apiFetch('/api/requirements', {
        method: 'POST',
        body: { title: 'Invalid assignee', assigneeIds: [seedIds.outsiderUserId] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    const requirement = await createRequirement('Invalid assignee patch')
    await expect(
      apiFetch(`/api/requirements/${requirement.id}`, {
        method: 'PATCH',
        body: { assigneeIds: [seedIds.outsiderUserId] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('hides requirements and revisions from another project', async () => {
    const otherRequirementId = 'req_other_private'
    const otherRevisionId = 'rev_other_private_1'
    const { client, db } = createDatabase(TEST_DATABASE_URL)
    try {
      await db.insert(requirements).values({
        id: otherRequirementId,
        projectId: seedIds.otherProjectId,
        key: 'OTHER-1',
        title: 'Other project requirement',
        statusId: seedIds.otherStatusId,
        reporterId: seedIds.currentUserId,
      })
      const document = requirementDoc('Private other-project content', 'other_body')
      await db.insert(requirementRevisions).values({
        id: otherRevisionId,
        requirementId: otherRequirementId,
        version: 1,
        title: 'Other project requirement',
        contentJson: document,
        contentText: 'Private other-project content',
        authorId: seedIds.currentUserId,
      })
    } finally {
      await client.end()
    }

    await expect(apiFetch(`/api/requirements/${otherRequirementId}`)).rejects.toMatchObject({ statusCode: 404 })
    await expect(apiFetch(`/api/requirements/${otherRequirementId}/revisions`)).rejects.toMatchObject({ statusCode: 404 })
    await expect(apiFetch(`/api/requirements/${otherRequirementId}/revisions?includeContent=true`)).rejects.toMatchObject({ statusCode: 404 })
    await expect(apiFetch(`/api/revisions/${otherRevisionId}`)).rejects.toMatchObject({ statusCode: 404 })
    expect(await apiFetch('/api/requirements')).toMatchObject({ items: [], total: 0 })
  })
})

describe('requirement revisions API', () => {
  it('saves revisions, lists them, reads one, and returns compare input data', async () => {
    const requirement = await createRequirement('Diff viewer')

    const revision = await apiFetch<Record<string, any>>(`/api/requirements/${requirement.id}/revisions`, {
      method: 'POST',
      body: {
        title: 'Diff viewer updated',
        contentJson: requirementDoc('Show changed rich text blocks'),
        changeNote: 'Add acceptance text',
      },
    })

    expect(revision.id).toMatch(/^rev_/)
    expect(revision.version).toBe(2)
    expect(revision.title).toBe('Diff viewer')
    expect(revision.contentText).toContain('Show changed rich text blocks')
    expect(revision.author.id).toBe(seedIds.currentUserId)

    const current = await apiFetch<Record<string, any>>(`/api/requirements/${requirement.id}`)
    expect(current.currentRevision.id).toBe(revision.id)
    expect(current.currentRevision.version).toBe(2)

    const revisions = await apiFetch<Array<Record<string, any>>>(`/api/requirements/${requirement.id}/revisions`)
    expect(revisions.map((item) => item.version)).toEqual([2, 1])
    for (const item of revisions) {
      expect(item).not.toHaveProperty('contentJson')
      expect(item).not.toHaveProperty('contentText')
      expect(item).not.toHaveProperty('attribution')
      expect(item).toMatchObject({ editors: [], editorsIncomplete: true })
      expect(Object.keys(item.author).sort()).toEqual(['avatarColor', 'id', 'name'])
    }

    const loaded = await apiFetch<Record<string, any>>(`/api/revisions/${revision.id}`)
    expect(loaded.id).toBe(revision.id)
    expect(loaded.contentJson.content[0].attrs.diffId).toBe('body')
    const history = await apiFetch<Array<Record<string, any>>>(`/api/requirements/${requirement.id}/revisions?includeContent=true`)
    expect(history.map(item => item.id)).toEqual(revisions.map(item => item.id))
    expect(history[0].contentJson).toEqual(loaded.contentJson)
    await expect(apiFetch(`/api/requirements/${requirement.id}/revisions?includeContent=invalid`)).rejects.toMatchObject({ statusCode: 400 })

    const compare = await apiFetch<Record<string, any>>('/api/revisions/compare', {
      query: {
        baseId: revisions[1].id,
        targetId: revisions[0].id,
      },
    })

    expect(compare.base.id).toBe(revisions[1].id)
    expect(compare.target.id).toBe(revisions[0].id)
  })

  it('accepts editor table and image nodes but rejects unknown Tiptap nodes', async () => {
    const requirement = await createRequirement('Runtime JSON validation')
    const contentJson: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { diffId: 'table_1' },
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { diffId: 'header_1' },
                      content: [{ type: 'text', text: 'Column' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'image',
          attrs: {
            src: '/uploads/runtime-validation.png',
            alt: 'Runtime validation',
            title: null,
            width: 640,
            height: 360,
            align: 'center',
            diffId: 'image_1',
          },
          content: [
            {
              type: 'imageCaption',
              content: [{ type: 'text', text: 'Validated caption' }],
            },
          ],
        },
      ],
    }

    const saved = await apiFetch<Record<string, any>>(`/api/requirements/${requirement.id}/revisions`, {
      method: 'POST',
      body: { title: 'Valid complex document', contentJson, changeNote: '' },
    })
    expect(saved.version).toBe(2)

    await expect(
      apiFetch(`/api/requirements/${requirement.id}/revisions`, {
        method: 'POST',
        body: {
          title: 'Unknown node',
          contentJson: {
            type: 'doc',
            content: [{ type: 'unknownWidget', attrs: { diffId: 'bad_1' } }],
          },
          changeNote: '',
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    await expect(apiFetch(`/api/requirements/${requirement.id}/revisions`, { method: 'POST', body: {
      title: '非法提示块', changeNote: '', contentJson: { type: 'doc', content: [{ type: 'callout', attrs: { tone: 'unknown' } }] },
    } })).rejects.toMatchObject({ statusCode: 400 })
    const revisions = await apiFetch<Array<Record<string, any>>>(`/api/requirements/${requirement.id}/revisions`)
    expect(revisions.map((revision) => revision.version)).toEqual([2, 1])
  })
})

describe('assets API', () => {
  it('uploads an image asset for a requirement', async () => {
    const requirement = await createRequirement('Image upload')
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const asset = await uploadImage(requirement.id, 'tiny.png')

    expect(asset.id).toMatch(/^asset_/)
    expect(asset.requirementId).toBe(requirement.id)
    expect(asset.fileName).toBe('tiny.png')
    expect(asset.mimeType).toBe('image/png')
    expect(asset.size).toBe(pngBytes.byteLength)
    expect(asset.url).toMatch(/^\/uploads\/asset_.*\.png$/)
    expect(asset.uploadedById).toBe(seedIds.currentUserId)

    await expect($fetch(asset.url, { responseType: 'arrayBuffer' })).rejects.toMatchObject({ statusCode: 401 })
    const downloaded = await apiFetch<ArrayBuffer>(asset.url, { responseType: 'arrayBuffer' })
    expect(new Uint8Array(downloaded)).toEqual(pngBytes)
  })

  it('removes the uploaded file when the asset database insert fails', async () => {
    const requirement = await createRequirement('Failed asset insert')
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      `${'x'.repeat(241)}.png`,
    )

    await expect(
      apiFetch('/api/assets/upload', {
        method: 'POST',
        query: { requirementId: requirement.id },
        body: form,
      }),
    ).rejects.toBeDefined()

    expect(await readdir(uploadsDir)).toEqual([])
  })

  it('garbage-collects only expired assets absent from every historical revision', async () => {
    const requirement = await createRequirement('Asset GC')
    const referencedAsset = await uploadImage(requirement.id, 'referenced.png')
    const orphanAsset = await uploadImage(requirement.id, 'orphan.png')

    await apiFetch(`/api/requirements/${requirement.id}/revisions`, {
      method: 'POST',
      body: {
        title: 'Reference one image',
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                src: referencedAsset.url,
                alt: referencedAsset.fileName,
                title: null,
                width: 320,
                height: 180,
                align: 'left',
                diffId: 'gc_image',
              },
              content: [{ type: 'imageCaption' }],
            },
          ],
        },
        changeNote: '',
      },
    })

    const { client, db } = createDatabase(TEST_DATABASE_URL)
    try {
      await db.update(assets).set({ createdAt: new Date('2020-01-01T00:00:00Z') })
      const result = await garbageCollectAssets(db, {
        storage: createAssetStorage({ driver: 'local', uploadDir: uploadsDir }),
        graceMs: 24 * 60 * 60 * 1000,
        now: new Date('2020-01-03T00:00:00Z'),
      })

      expect(result.deleted).toEqual([orphanAsset.id])
      const remaining = await db.select().from(assets)
      expect(remaining.map((asset) => asset.id)).toEqual([referencedAsset.id])
    } finally {
      await client.end()
    }

    const referencedFile = resolve(uploadsDir, basename(referencedAsset.url))
    const orphanFile = resolve(uploadsDir, basename(orphanAsset.url))
    await expect(access(referencedFile)).resolves.toBeUndefined()
    await expect(access(orphanFile)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(apiFetch(orphanAsset.url)).rejects.toMatchObject({ statusCode: 404 })
  })
})
