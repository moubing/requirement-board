import { collaborationEditsSchema } from '../../../../shared/collaboration/edit-validation'
import { acceptCollaborationEdits } from '../../../services/collaboration'
import { requireAppContext } from '../../../utils/request-context'
import { requireDraftRequirement } from '../../../services/requirement-drafts'

export default defineEventHandler(async event => {
  const { db, projectId, currentUser } = await requireAppContext(event)
  const requirementId = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, requirementId, projectId)
  const raw = await readRawBody(event)
  if (!raw || Buffer.byteLength(raw) > 24 * 1024 * 1024) throw createError({ statusCode: 413, message: '编辑请求过大或为空' })
  let input: unknown
  try { input = JSON.parse(raw) } catch { throw createError({ statusCode: 400, message: '编辑请求格式无效' }) }
  const parsed = collaborationEditsSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 400, message: '编辑请求格式无效' })
  setHeader(event, 'cache-control', 'no-store')
  return acceptCollaborationEdits(db, requirementId, projectId, currentUser, parsed.data.edits, parsed.data.stateVector, parsed.data.editEpoch,
    parsed.data.schemaVersion ?? Number(getHeader(event, 'x-rb-document-schema') ?? 0),
    parsed.data.schemaCapabilities ?? getHeader(event, 'x-rb-document-capabilities')?.split(',') ?? [])
})
