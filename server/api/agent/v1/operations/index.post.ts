import { requireAgentContext } from '../../../../services/agent-tokens'
import { submitAgentOperation } from '../../../../services/agent-operations'
import { readAgentSuggestionInput } from '../../../../utils/agent-input'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  if (getHeader(event, 'x-rb-mode') && getHeader(event, 'x-rb-mode') !== 'takeover') throw createError({ statusCode: 400, message: '文档操作直接执行，不支持审核模式' })
  return submitAgentOperation(db, currentUserId, projectId, await readAgentSuggestionInput(event), agentTokenId)
})
