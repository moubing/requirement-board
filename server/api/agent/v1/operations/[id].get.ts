import { requireAgentContext } from '../../../../services/agent-tokens'
import { getAgentOperation } from '../../../../services/agent-operations'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return getAgentOperation(db, projectId, getRouterParam(event, 'id')!, currentUserId)
})
