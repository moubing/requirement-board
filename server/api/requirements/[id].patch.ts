import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as Y from 'yjs'
import { nanoid } from 'nanoid'
import { createHash } from 'node:crypto'
import { readCollaborationDocument, updateCollaborativeTitle } from '../../../shared/collaboration/document'
import { addNodeContributors, changedAttributionNodes } from '../../../shared/collaboration/attribution'
import { requirementPropertyPatchSchema } from '../../../shared/requirements/properties'
import { requirementCollaborationDocuments, requirementEditEvents, requirements, requirementStatuses } from '../../db/schema'
import { requireAppContext } from '../../utils/request-context'
import { assertRequirementUnlocked } from '../../services/agent-locks'
import { updateRequirementProperties, updateRequirementTitle } from '../../services/requirement-properties'
import { broadcastRequirementProperties, publishAgentState, withLockedCollaboration } from '../../services/collaboration'
import { currentNodeContributions } from '../../services/node-contributions'
import { withDocumentAssignees } from '../../services/document-assignees'

const patchRequirementSchema = requirementPropertyPatchSchema.extend({
  title: z.string().trim().min(1).max(240).optional(),
  mutationId: z.string().min(1).max(100).optional(),
  /** 拖拽与撤销携带提交前看到的状态；当前状态不同说明已被他人修改，返回 409 不覆盖。 */
  expectedStatusId: z.string().min(1).max(200).optional(),
})

export default defineEventHandler(async event => {
  const id = getRouterParam(event, 'id')!
  const { db, projectId, currentUserId, currentUser } = await requireAppContext(event)
  const input = patchRequirementSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: input.error.issues[0]?.message ?? '文档修改参数无效' })
  const { title, mutationId, expectedStatusId, ...properties } = input.data
  const operationId = `operation_${nanoid(24)}`
  const update = (document?: Y.Doc) => db.transaction(async tx => {
    const [row] = await tx.select().from(requirements).where(and(eq(requirements.id, id), eq(requirements.projectId, projectId))).for('update')
    if (!row) throw createError({ statusCode: 404, statusMessage: 'Requirement not found' })
    await assertRequirementUnlocked(tx, id)
    if (expectedStatusId !== undefined && row.statusId !== expectedStatusId) {
      const current = await tx.query.requirementStatuses.findFirst({ where: eq(requirementStatuses.id, row.statusId) })
      throw createError({ statusCode: 409, message: `状态已被他人改为「${current?.name ?? '未知状态'}」，本次修改未提交`,
        data: { code: 'STATUS_CONFLICT', currentStatus: current ? { id: current.id, code: current.code, name: current.name, color: current.color } : null } })
    }
    const changes = await updateRequirementProperties(tx, row, properties, currentUserId, 'web', operationId)
    const titleChanged = title !== undefined && await updateRequirementTitle(tx, row, title, currentUserId, 'web', operationId)
    let collaboration: typeof requirementCollaborationDocuments.$inferSelect | undefined
    if (document && title !== undefined) {
      const [current] = await tx.select().from(requirementCollaborationDocuments)
        .where(eq(requirementCollaborationDocuments.requirementId, id)).for('update')
      if (!current) throw createError({ statusCode: 404, message: '协作文档不存在' })
      const candidate = new Y.Doc()
      try {
        Y.applyUpdate(candidate, current.state)
        // 沿用现有 Yjs 历史，仅更新兼容标题字段，不重建或替换正文。
        const before = readCollaborationDocument(candidate)
        updateCollaborativeTitle(candidate.getText('title'), title)
        const after = readCollaborationDocument(candidate)
        if (before.title !== after.title) {
          const attribution = addNodeContributors(await currentNodeContributions(tx, current), changedAttributionNodes(before, after),
            { userId: currentUserId, name: currentUser.name })
          const state = Y.encodeStateAsUpdate(candidate)
          await tx.insert(requirementEditEvents).values({ id: `edit_${nanoid(24)}`, requirementId: id,
            sequence: current.attributionSequence + 1, authorId: currentUserId, authorName: currentUser.name,
            intent: 'edit', updateHash: createHash('sha256').update(state).digest('hex'), blockIds: ['$title'], changes: [] })
          ;[collaboration] = await tx.update(requirementCollaborationDocuments).set({ ...after,
            state, attribution, attributionSequence: current.attributionSequence + 1, updatedAt: new Date() })
            .where(eq(requirementCollaborationDocuments.requirementId, id)).returning()
        }
      } finally { candidate.destroy() }
    }
    return { changed: changes.length > 0 || titleChanged, collaboration }
  })
  if (title === undefined) {
    if ((await update()).changed) broadcastRequirementProperties(id, mutationId)
  } else {
    // 在打开协作房间前校验文档归属，避免未授权请求初始化房间。
    const row = await db.query.requirements.findFirst({ where: and(eq(requirements.id, id), eq(requirements.projectId, projectId)) })
    if (!row) throw createError({ statusCode: 404, message: '文档不存在' })
    await withLockedCollaboration(id, async document => {
      const result = await update(document)
      if (result.collaboration) publishAgentState(id, document, result.collaboration)
      if (result.changed) broadcastRequirementProperties(id, mutationId)
    })
  }
  const row = await db.query.requirements.findFirst({ where: and(eq(requirements.id, id), eq(requirements.projectId, projectId)),
    with: { status: true, reporter: true } })
  return (await withDocumentAssignees(db, [row!]))[0]!
})
