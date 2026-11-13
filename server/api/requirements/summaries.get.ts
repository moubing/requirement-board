import { readRequirementSummaries } from '../../services/requirement-queries'
import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { requirementSummariesQuerySchema } from '../../../shared/requirements/query'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  setHeader(event, 'cache-control', 'no-store')
  return readRequirementSummaries(db, projectId, parseAccountInput(requirementSummariesQuerySchema, getQuery(event)).ids)
})
