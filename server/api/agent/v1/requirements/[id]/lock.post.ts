import { z } from 'zod'
import { requireAgentContext } from '../../../../../services/agent-tokens'
import { changeAgentLock } from '../../../../../services/agent-operations'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  const body = z.object({ snapshotId: z.string().regex(/^snap_[a-zA-Z0-9_-]{16,64}$/), action: z.enum(['renew', 'release']) }).strict().parse(await readBody(event))
  setHeader(event, 'cache-control', 'no-store')
  return changeAgentLock(db, getRouterParam(event, 'id')!, projectId, { userId: currentUserId, tokenId: agentTokenId }, body.snapshotId, body.action)
})
