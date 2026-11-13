import { requireAgentContext } from '../../../../../../services/agent-tokens'
import { changeAgentRelatedDocuments } from '../../../../../../services/agent-relations'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return changeAgentRelatedDocuments(db, projectId, getRouterParam(event, 'id')!, [getRouterParam(event, 'relatedId')!], 'remove')
})
