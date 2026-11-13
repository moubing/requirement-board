import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { listRequirementPage } from '../../services/requirement-queries'
import { requirementPageQuerySchema } from '../../../shared/requirements/query'

export default defineEventHandler(async (event) => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return listRequirementPage(db, projectId, currentUserId, parseAccountInput(requirementPageQuerySchema, getQuery(event)))
})
