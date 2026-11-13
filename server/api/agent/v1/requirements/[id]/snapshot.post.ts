import { requireAgentContext } from '../../../../../services/agent-tokens'
import { createAgentSnapshot } from '../../../../../services/agent-operations'
import { agentRequirement } from '../../../../../services/agent-reading'
import { conditionalReadSchema, parseAgentQuery } from '../../../../../utils/agent-query'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const row = await agentRequirement(db, projectId, getRouterParam(event, 'id')!)
  const input = parseAgentQuery(conditionalReadSchema, await readBody(event) ?? {})
  return createAgentSnapshot(db, row.id, projectId, currentUserId, agentTokenId, input.ifContentToken)
})
