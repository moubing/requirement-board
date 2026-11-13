import { changeRelatedDocuments } from '../../../../services/requirement-relations'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  return changeRelatedDocuments(db, projectId, getRouterParam(event, 'id')!, [getRouterParam(event, 'relatedId')!], 'remove')
})
