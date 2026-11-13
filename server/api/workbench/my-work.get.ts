import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { readMyWorkStatistics } from '../../services/workbench-my-work'
import { workQuerySchema } from '../../../shared/statistics/workbench'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  const query = parseAccountInput(workQuerySchema, getQuery(event))
  setHeader(event, 'cache-control', 'no-store')
  return readMyWorkStatistics(db, projectId, currentUserId, query)
})
