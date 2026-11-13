import { eq } from 'drizzle-orm'

import { requirementRevisions } from '../../db/schema'
import { requireAppContext } from '../../utils/request-context'
import { revisionNodeContributions } from '../../services/node-contributions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing revision id' })

  const { db, projectId } = await requireAppContext(event)
  const revision = await db.query.requirementRevisions.findFirst({
    where: eq(requirementRevisions.id, id),
    with: { author: true, requirement: true },
  })

  if (!revision || revision.requirement.projectId !== projectId) {
    throw createError({ statusCode: 404, statusMessage: 'Revision not found' })
  }

  const { requirement: _requirement, ...result } = revision
  return revisionNodeContributions(db, result)
})
