import { desc, eq } from 'drizzle-orm'
import { requireAgentContext } from '../../../../../services/agent-tokens'
import { agentRequirement } from '../../../../../services/agent-reading'
import { requirementRevisions } from '../../../../../db/schema'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const row = await agentRequirement(db, projectId, getRouterParam(event, 'id')!)
  return db.query.requirementRevisions.findMany({ where: eq(requirementRevisions.requirementId, row.id),
    columns: { contentJson: false, contentText: false, attribution: false }, with: { author: { columns: { id: true, name: true } } },
    orderBy: desc(requirementRevisions.version) })
})
