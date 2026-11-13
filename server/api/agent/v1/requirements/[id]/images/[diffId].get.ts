import { z } from 'zod'
import { requireAgentContext } from '../../../../../../services/agent-tokens'
import { readAgentImage } from '../../../../../../services/agent-image-reading'
import { parseAgentQuery } from '../../../../../../utils/agent-query'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  const query = parseAgentQuery(z.object({ snapshotId: z.string().regex(/^snap_[a-zA-Z0-9_-]{16,64}$/).optional() }).strict(), getQuery(event))
  const diffId = getRouterParam(event, 'diffId')
  if (!diffId || diffId.length > 100) throw createError({ statusCode: 400, message: '图片节点 ID 无效' })
  const result = await readAgentImage(db, projectId, currentUserId, agentTokenId, getRouterParam(event, 'id')!, diffId, query.snapshotId)
  setHeaders(event, { 'cache-control': 'no-store', 'content-type': result.mime, 'content-length': result.bytes.length,
    'x-content-type-options': 'nosniff', 'x-rb-image-first-frame-only': String(result.firstFrameOnly) })
  return result.bytes
})
