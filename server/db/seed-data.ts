import { and, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'

import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { BLOCK_NODE_TYPES, extractPlainText, type RichTextNode } from '../../shared/editor/document'
import { richTextDocumentSchema } from '../../shared/editor/validation'
import { ACTIVE_DOCUMENT_STATES, DOCUMENT_STATES } from '../../shared/documents/workflow'
import type { Transaction } from './client'
import { projectMembers, projects, requirementCollaborationDocuments, requirementRevisions, requirementStatuses, requirements, users } from './schema'
import quickStart from './seeds/01-quick-start.json'
import management from './seeds/02-requirement-management.json'
import editor from './seeds/03-editor.json'
import collaboration from './seeds/04-collaboration.json'
import versions from './seeds/05-versions.json'
import ai from './seeds/06-ai-collaboration.json'
import accounts from './seeds/07-accounts.json'

export const seedManuals = [quickStart, management, editor, collaboration, versions, ai, accounts]
export const seedProjectId = 'project_main'
export const seedAdminId = 'admin'

const legacyStatusIds: Record<string, string> = { draft: 'status_backlog', development: 'status_progress' }
/** 新库只写入启用状态；旧流程状态仅在升级的旧库中以停用行保留。 */
export const seedStatuses = ACTIVE_DOCUMENT_STATES.map((code, index) => ({ id: legacyStatusIds[code] ?? `status_${code}`, code, ...DOCUMENT_STATES[code], sortOrder: (index + 1) * 10 }))

export function validateSeedManuals() {
  const destinations = new Set(seedManuals.map(manual => `/requirements/${manual.id}`))
  return seedManuals.map(manual => {
    const contentJson = richTextDocumentSchema.parse(manual.contentJson)
    const ids = new Set<string>()
    let cellIndex = 0
    function visit(node: RichTextNode) {
      // 种子模板的单元格身份在首次创建时确定；已安装手册与历史版本不会重写。
      if (['tableCell', 'tableHeader'].includes(node.type) && !node.attrs?.diffId) {
        node.attrs = { ...node.attrs, diffId: `${manual.id}_cell_${cellIndex++}` }
      }
      if ((BLOCK_NODE_TYPES as readonly string[]).includes(node.type)) {
        const id = node.attrs?.diffId
        if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error(`${manual.title}：块 ID 缺失或重复`)
        ids.add(id)
      }
      // 手册必须能在全新环境独立初始化，不能依赖本机上传文件。
      if (node.type === 'image') throw new Error(`${manual.title}：图片尚未纳入种子资源`)
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link' && !destinations.has(String(mark.attrs?.href))) {
          throw new Error(`${manual.title}：存在未纳入种子的链接`)
        }
      }
      node.content?.forEach(visit)
    }
    contentJson.content.forEach(visit)
    return { ...manual, contentJson }
  })
}

/** 调用方持有事务；普通 seed 只补缺失手册，绝不覆盖已编辑的正文或历史。 */
export async function seedDatabase(tx: Transaction, editEpoch = 0) {
  const manuals = validateSeedManuals()
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('requirement-board:seed'))`)
  await tx.insert(users).values({
    id: seedAdminId, name: 'admin', email: 'admin@requirement-board.local', username: 'admin',
    displayUsername: 'admin', role: 'admin', avatarColor: '#172033',
  }).onConflictDoNothing()
  await tx.insert(projects).values({
    id: seedProjectId, name: '文档看板', code: 'REQ', description: '项目文档、流程与共同编辑。',
  }).onConflictDoNothing()
  await tx.insert(projectMembers).values({ projectId: seedProjectId, userId: seedAdminId }).onConflictDoNothing()
  await tx.insert(requirementStatuses).values(seedStatuses.map(status => ({ ...status, projectId: seedProjectId }))).onConflictDoNothing()
  const published = await tx.query.requirementStatuses.findFirst({ where: and(eq(requirementStatuses.projectId, seedProjectId), eq(requirementStatuses.code, 'published')) })

  const [project] = await tx.select().from(projects).where(eq(projects.id, seedProjectId))
  const existing = await tx.select({ id: requirements.id, key: requirements.key }).from(requirements)
  const existingIds = new Set(existing.map(row => row.id))
  const usedKeys = new Set(existing.map(row => row.key))
  let nextNumber = 1
  let created = 0
  for (const manual of manuals) {
    if (existingIds.has(manual.id)) continue
    while (usedKeys.has(`${project!.code}-${nextNumber}`)) nextNumber++
    const key = `${project!.code}-${nextNumber++}`
    usedKeys.add(key)
    const revisionId = `rev_seed_${nanoid(12)}`
    const doc = createCollaborationDocument({ title: manual.title, contentJson: structuredClone(manual.contentJson) })
    try {
      const snapshot = readCollaborationDocument(doc)
      await tx.insert(requirements).values({
        id: manual.id, projectId: seedProjectId, key, title: manual.title,
        documentType: 'instruction', statusId: published!.id, reporterId: seedAdminId, priority: 'medium',
      })
      await tx.insert(requirementRevisions).values({
        id: revisionId, requirementId: manual.id, version: 1, ...snapshot,
        contentText: extractPlainText(snapshot.contentJson), changeNote: '使用手册初始种子版本', authorId: seedAdminId,
      })
      await tx.insert(requirementCollaborationDocuments).values({
        requirementId: manual.id, ...snapshot, state: Y.encodeStateAsUpdate(doc), editEpoch,
        attribution: { version: 2, baseRevisionId: revisionId, baseVersion: 1, nodes: [] },
      })
      created++
    } finally {
      doc.destroy()
    }
  }
  return { created, skipped: manuals.length - created }
}
