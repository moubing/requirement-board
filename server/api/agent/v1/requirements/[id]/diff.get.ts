import { requireAgentContext } from '../../../../../services/agent-tokens'
import { compareAgentVersions } from '../../../../../services/agent-history'
import { diffQuerySchema, parseAgentQuery } from '../../../../../utils/agent-query'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return compareAgentVersions(db, projectId, getRouterParam(event, 'id')!, parseAgentQuery(diffQuerySchema, getQuery(event)))
})
