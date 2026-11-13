import { eq } from 'drizzle-orm'
import { requireAgentContext } from '../../../../services/agent-tokens'
import { agentRequirement } from '../../../../services/agent-reading'
import { requirementRevisions } from '../../../../db/schema'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const row = await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.id, getRouterParam(event, 'id')!),
    with: { author: { columns: { id: true, name: true } } } })
  if (!row) throw createError({ statusCode: 404, message: '版本不存在' })
  await agentRequirement(db, projectId, row.requirementId)
  return row
})
