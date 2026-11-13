import { requireAgentContext } from '../../../../../services/agent-tokens'
import { agentTextHistory } from '../../../../../services/agent-history'
import { historyQuerySchema, parseAgentQuery } from '../../../../../utils/agent-query'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return agentTextHistory(db, projectId, getRouterParam(event, 'id')!, parseAgentQuery(historyQuerySchema, getQuery(event)))
})
