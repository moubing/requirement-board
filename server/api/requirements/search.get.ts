import { searchRequirementSummaries } from '../../services/requirement-queries'
import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { requirementSearchQuerySchema } from '../../../shared/requirements/query'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return searchRequirementSummaries(db, projectId, parseAccountInput(requirementSearchQuerySchema, getQuery(event)))
})
