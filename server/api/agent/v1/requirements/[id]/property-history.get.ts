import { requireAgentContext } from '../../../../../services/agent-tokens'
import { agentRequirement } from '../../../../../services/agent-reading'
import { propertyHistory } from '../../../../../services/requirement-properties'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const row = await agentRequirement(db, projectId, getRouterParam(event, 'id')!)
  const cursor = getQuery(event).cursor
  return propertyHistory(db, projectId, row.id, typeof cursor === 'string' ? cursor : undefined)
})
