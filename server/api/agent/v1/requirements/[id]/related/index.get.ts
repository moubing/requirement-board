import { requireAgentContext } from '../../../../../../services/agent-tokens'
import { listAgentRelatedDocuments } from '../../../../../../services/agent-relations'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return listAgentRelatedDocuments(db, projectId, getRouterParam(event, 'id')!)
})
