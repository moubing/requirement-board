import { agentDocumentSchema } from '../../../../shared/agent/schema'
import { requireAgentContext } from '../../../services/agent-tokens'

export default defineEventHandler(async event => {
  await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return agentDocumentSchema()
})
