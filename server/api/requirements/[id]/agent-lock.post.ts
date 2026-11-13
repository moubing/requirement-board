import { z } from 'zod'
import { requireAppContext } from '../../../utils/request-context'
import { changeAgentLock } from '../../../services/agent-operations'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser } = await requireAppContext(event)
  const body = z.object({ snapshotId: z.string().regex(/^snap_[a-zA-Z0-9_-]{16,64}$/) }).strict().parse(await readBody(event))
  return changeAgentLock(db, getRouterParam(event, 'id')!, projectId,
    { userId: currentUserId, admin: currentUser.role === 'admin' }, body.snapshotId, 'release')
})
