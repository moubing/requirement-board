import { draftIdSchema, draftWriteSchema } from '../../../../../shared/drafts/validation'
import { writeDraft } from '../../../../services/requirement-drafts'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const draftId = draftIdSchema.safeParse(getRouterParam(event, 'draftId'))
  const raw = await readRawBody(event)
  if (!raw || Buffer.byteLength(raw) > 4 * 1024 * 1024) throw createError({ statusCode: 413, message: '草稿过大，请缩减正文后重试' })
  let body: unknown
  try { body = JSON.parse(raw) } catch { throw createError({ statusCode: 400, message: '草稿格式无效' }) }
  const input = draftWriteSchema.safeParse(body)
  if (!draftId.success || !input.success) throw createError({ statusCode: 400, message: '草稿格式无效' })
  return writeDraft(db, getRouterParam(event, 'id')!, projectId, currentUserId, draftId.data, input.data)
})
