import { inArray } from 'drizzle-orm'
import { z } from 'zod'

import { requirementRevisions } from '../../db/schema'
import { requireAppContext } from '../../utils/request-context'
import { revisionNodeContributions } from '../../services/node-contributions'

const querySchema = z.object({
  baseId: z.string().min(1),
  targetId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const { db, projectId } = await requireAppContext(event)
  const query = querySchema.parse(getQuery(event))
  const revisions = await db.query.requirementRevisions.findMany({
    where: inArray(requirementRevisions.id, [query.baseId, query.targetId]),
    with: { author: true, requirement: true },
  })

  const baseRow = revisions.find((revision) => revision.id === query.baseId)
  const targetRow = revisions.find((revision) => revision.id === query.targetId)

  if (
    !baseRow
    || !targetRow
    || baseRow.requirement.projectId !== projectId
    || targetRow.requirement.projectId !== projectId
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Revision not found' })
  }

  if (baseRow.requirementId !== targetRow.requirementId) {
    throw createError({ statusCode: 400, statusMessage: 'Revisions belong to different requirements' })
  }

  const { requirement: _baseRequirement, ...base } = baseRow
  const { requirement: _targetRequirement, ...target } = targetRow
  const [baseResult, targetResult] = await Promise.all([revisionNodeContributions(db, base), revisionNodeContributions(db, target)])
  return { base: baseResult, target: targetResult }
})
