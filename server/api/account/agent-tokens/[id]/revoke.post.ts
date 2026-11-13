import { requireAppContext } from '../../../../utils/request-context'
import { revokeAgentToken } from '../../../../services/agent-tokens'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  return revokeAgentToken(db, currentUserId, projectId, getRouterParam(event, 'id')!)
})
