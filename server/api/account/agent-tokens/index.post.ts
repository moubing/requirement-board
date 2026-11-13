import { agentTokenInputSchema } from '../../../../shared/agent/tokens'
import { requireAppContext } from '../../../utils/request-context'
import { createAgentToken } from '../../../services/agent-tokens'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const input = agentTokenInputSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '凭证参数无效' })
  setHeader(event, 'cache-control', 'no-store')
  return createAgentToken(db, currentUserId, projectId, input.data)
})
