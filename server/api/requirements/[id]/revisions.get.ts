import { desc, eq } from 'drizzle-orm'

import { requirementRevisions } from '../../../db/schema'
import { requireAppContext } from '../../../utils/request-context'
import { revisionNodeContributions } from '../../../services/node-contributions'
import { listRevisionSummaries } from '../../../services/revision-reading'

export default defineEventHandler(async (event) => {
  const requirementId = getRouterParam(event, 'id')
  if (!requirementId) throw createError({ statusCode: 400, statusMessage: 'Missing requirement id' })

  const { db, projectId } = await requireAppContext(event)
  const requirement = await db.query.requirements.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, requirementId), eq(table.projectId, projectId)),
    columns: { id: true },
  })
  if (!requirement) {
    throw createError({ statusCode: 404, statusMessage: 'Requirement not found' })
  }

  const includeContent = getQuery(event).includeContent
  if (includeContent !== undefined && includeContent !== 'true') {
    throw createError({ statusCode: 400, statusMessage: 'includeContent must be true when provided' })
  }
  if (!includeContent) return listRevisionSummaries(db, requirementId)

  // 选区历史需要完整相邻链；仅在用户打开该功能时显式读取。
  const revisions = await db.query.requirementRevisions.findMany({
    where: eq(requirementRevisions.requirementId, requirementId),
    with: { author: { columns: { id: true, name: true, avatarColor: true } } },
    orderBy: desc(requirementRevisions.version),
  })
  return Promise.all(revisions.map(revision => revisionNodeContributions(db, revision)))
})
