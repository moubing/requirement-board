import { groupRequirements } from '../../services/requirement-queries'
import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { requirementFilterSchema } from '../../../shared/requirements/query'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return groupRequirements(db, projectId, currentUserId, parseAccountInput(requirementFilterSchema, getQuery(event)))
})
