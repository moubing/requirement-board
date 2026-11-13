import { and, desc, eq } from 'drizzle-orm'

import { requirementRevisions, requirements } from '../../db/schema'
import { requireAppContext } from '../../utils/request-context'
import { revisionNodeContributions } from '../../services/node-contributions'
import { withDocumentAssignees } from '../../services/document-assignees'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing requirement id' })

  const { db, projectId } = await requireAppContext(event)
  const requirement = await db.query.requirements.findFirst({
    where: and(eq(requirements.id, id), eq(requirements.projectId, projectId)),
    with: {
      status: true,
      reporter: true,
    },
  })

  if (!requirement) {
    throw createError({ statusCode: 404, statusMessage: 'Requirement not found' })
  }

  // 只有通过当前项目权限检查后，才允许调用方复用已持有的不可变版本正文。
  setHeader(event, 'Cache-Control', 'private, no-store')
  const knownRevisionId = getQuery(event).knownRevisionId
  if (knownRevisionId !== undefined && typeof knownRevisionId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Invalid known revision id' })
  }
  if (knownRevisionId) {
    const latest = await db.query.requirementRevisions.findFirst({
      columns: { id: true },
      where: eq(requirementRevisions.requirementId, requirement.id),
      orderBy: desc(requirementRevisions.version),
    })
    if (latest?.id === knownRevisionId) {
      return {
        ...(await withDocumentAssignees(db, [requirement]))[0]!,
        currentRevisionId: latest.id,
        currentRevisionUnchanged: true as const,
      }
    }
  }

  const currentRevision = await db.query.requirementRevisions.findFirst({
    where: eq(requirementRevisions.requirementId, requirement.id),
    with: { author: true },
    orderBy: desc(requirementRevisions.version),
  })

  return {
    ...(await withDocumentAssignees(db, [requirement]))[0]!,
    currentRevision: currentRevision ? await revisionNodeContributions(db, currentRevision) : null,
  }
})
