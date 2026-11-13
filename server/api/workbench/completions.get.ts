import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { readWorkbenchCompletions } from '../../services/workbench-home'
import { completionQuerySchema } from '../../../shared/workbench/home'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  const { scope } = parseAccountInput(completionQuerySchema, getQuery(event))
  setHeader(event, 'cache-control', 'no-store')
  return readWorkbenchCompletions(db, projectId, currentUserId, scope)
})
