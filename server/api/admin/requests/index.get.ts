import { listAccessRequests } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'
import { parseAccountInput, paginationSchema } from '../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const { db } = await requireSystemAdminContext(event)
  const { page, limit } = parseAccountInput(paginationSchema, getQuery(event))
  return listAccessRequests(db, page, limit)
})
