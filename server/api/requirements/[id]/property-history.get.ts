import { requireAppContext } from '../../../utils/request-context'
import { propertyHistory } from '../../../services/requirement-properties'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  const cursor = getQuery(event).cursor
  return propertyHistory(db, projectId, getRouterParam(event, 'id')!, typeof cursor === 'string' ? cursor : undefined)
})
