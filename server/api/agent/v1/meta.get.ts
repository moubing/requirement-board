import { requireAgentContext } from '../../../services/agent-tokens'
import { agentMetadata } from '../../../services/agent-reading'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return agentMetadata(db, projectId)
})
