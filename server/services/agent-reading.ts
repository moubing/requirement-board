import { and, asc, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { Database, Transaction } from '../db/client'
import { collaborationSignature } from '../../shared/collaboration/document'
import { sameVersionContent } from '../../shared/editor/content-equality'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { projectMembers, requirementCollaborationDocuments, requirementRevisions, requirements, requirementStatuses, users } from '../db/schema'
import { propertiesOf } from './requirement-properties'
import { listRequirementPage } from './requirement-queries'
import type { RequirementPageQuery } from '../../shared/requirements/query'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_WORKFLOWS } from '../../shared/documents/workflow'

export async function agentRequirement(db: Database | Transaction, projectId: string, identifier: string) {
  const row = await db.query.requirements.findFirst({ where: and(eq(requirements.projectId, projectId),
    /^REQ-\d+$/.test(identifier) ? eq(requirements.key, identifier) : eq(requirements.id, identifier)) })
  if (!row) throw createError({ statusCode: 404, message: '需求不存在' })
  return row
}

export const agentContentToken = async (document: Parameters<typeof collaborationSignature>[0]) => `${DOCUMENT_SCHEMA_VERSION}:${await collaborationSignature(document)}`

export async function readAgentDocument(db: Database, projectId: string, identifier: string, options: { ifContentToken?: string; statusOnly?: boolean } = {}) {
  // 状态、正文和版本来自同一个数据库快照，避免并发保存时拼接不同时间点的数据。
  return db.transaction(async tx => {
    const row = await agentRequirement(tx, projectId, identifier)
    const current = await tx.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, row.id), columns: { title: true, contentJson: true, schemaVersion: true } })
    if (current && current.schemaVersion !== DOCUMENT_SCHEMA_VERSION) throw createError({ statusCode: 503, message: '共同草稿需要升级，请停服执行数据库迁移', data: { code: 'DOCUMENT_SCHEMA_MIGRATION_REQUIRED' } })
    const latest = await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, row.id), orderBy: desc(requirementRevisions.version), with: { author: { columns: { id: true, name: true } } } })
    const body = current ?? latest
    if (!body) throw createError({ statusCode: 404, message: '正文不存在' })
    const document = { title: row.title, contentJson: body.contentJson }
    const contentToken = await agentContentToken(document)
    const notModified = options.ifContentToken === contentToken
    return { id: row.id, key: row.key, documentType: row.documentType, schemaVersion: DOCUMENT_SCHEMA_VERSION, contentToken, notModified,
      modified: !latest || !sameVersionContent({ ...document, title: latest.title }, latest), properties: await propertiesOf(tx, row),
      ...(!options.statusOnly && !notModified ? { title: document.title, contentJson: document.contentJson } : {}),
      latestRevision: latest ? { id: latest.id, version: latest.version, title: latest.title,
        changeNote: latest.changeNote, createdAt: latest.createdAt, savedBy: latest.author } : null }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function searchAgentDocuments(db: Database, projectId: string, currentUserId: string, query: RequirementPageQuery) {
  return listRequirementPage(db, projectId, currentUserId, query)
}

export async function agentMetadata(db: Database, projectId: string) {
  const [members, statuses] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(users.banned, false))).orderBy(asc(users.name)),
    db.select({ id: requirementStatuses.id, name: requirementStatuses.name, code: requirementStatuses.code }).from(requirementStatuses)
      .where(and(eq(requirementStatuses.projectId, projectId), eq(requirementStatuses.active, true))).orderBy(asc(requirementStatuses.sortOrder)),
  ])
  return { members, statuses, documentTypes: DOCUMENT_TYPE_LABELS, workflows: DOCUMENT_WORKFLOWS, priorities: ['low', 'medium', 'high'] }
}
