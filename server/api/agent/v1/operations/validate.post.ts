import { requireAgentContext } from '../../../../services/agent-tokens'
import { submitAgentOperation } from '../../../../services/agent-operations'
import { readAgentSuggestionInput } from '../../../../utils/agent-input'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return submitAgentOperation(db, currentUserId, projectId, await readAgentSuggestionInput(event), agentTokenId, true)
})
