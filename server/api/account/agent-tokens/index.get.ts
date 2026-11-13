import { requireAppContext } from '../../../utils/request-context'
import { listAgentTokens } from '../../../services/agent-tokens'
import { parseAccountInput } from '../../../utils/account-input'
import { agentTokenQuerySchema } from '../../../../shared/agent/tokens'

export default defineEventHandler(async event => {
  const { db, currentUserId } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return listAgentTokens(db, currentUserId, parseAccountInput(agentTokenQuerySchema, getQuery(event)))
})
