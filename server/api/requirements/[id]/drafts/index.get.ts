import { listDrafts, requireDraftRequirement } from '../../../../services/requirement-drafts'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const id = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, id, projectId)
  setHeader(event, 'Cache-Control', 'no-store')
  return listDrafts(db, id, currentUserId)
})
