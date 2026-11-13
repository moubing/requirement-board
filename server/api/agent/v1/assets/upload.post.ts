import { z } from 'zod'
import { requireAgentContext } from '../../../../services/agent-tokens'
import { MAX_AGENT_IMAGE_BYTES, uploadAgentImage } from '../../../../services/agent-assets'
import { parseAgentQuery } from '../../../../utils/agent-query'

const querySchema = z.object({
  requirementId: z.string().regex(/^(req_[a-zA-Z0-9_-]{1,100}|REQ-[1-9][0-9]*)$/).optional(),
  createRequestId: z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/).optional(),
  uploadId: z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/),
}).strict().refine(value => Boolean(value.requirementId) !== Boolean(value.createRequestId))

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, agentTokenId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const query = parseAgentQuery(querySchema, getQuery(event))
  if (Number(event.headers.get('content-length')) > MAX_AGENT_IMAGE_BYTES + 64 * 1024) throw createError({ statusCode: 413, message: '图片不得超过 5 MiB' })
  const form = await readMultipartFormData(event)
  const files = form?.filter(item => item.name === 'file')
  if (files?.length !== 1 || !files[0]?.filename) throw createError({ statusCode: 400, message: '需要一个 file 图片字段' })
  return uploadAgentImage(db, projectId, currentUserId, agentTokenId, query, { data: files[0].data, filename: files[0].filename })
})
