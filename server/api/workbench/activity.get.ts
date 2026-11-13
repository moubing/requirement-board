import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { readWorkbenchActivity } from '../../services/workbench-home'
import { activityQuerySchema } from '../../../shared/workbench/home'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  const query = parseAccountInput(activityQuerySchema, getQuery(event))
  setHeader(event, 'cache-control', 'no-store')
  return readWorkbenchActivity(db, projectId, currentUserId, query)
})
