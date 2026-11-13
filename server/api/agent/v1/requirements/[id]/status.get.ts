import { requireAgentContext } from '../../../../../services/agent-tokens'
import { readAgentDocument } from '../../../../../services/agent-reading'
import { conditionalReadSchema, parseAgentQuery } from '../../../../../utils/agent-query'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return readAgentDocument(db, projectId, getRouterParam(event, 'id')!, { ...parseAgentQuery(conditionalReadSchema, getQuery(event)), statusOnly: true })
})
