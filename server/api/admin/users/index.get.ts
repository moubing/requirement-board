import { listManagedUsers } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'
import { parseAccountInput, userQuerySchema } from '../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const { db } = await requireSystemAdminContext(event)
  return listManagedUsers(db, parseAccountInput(userQuerySchema, getQuery(event)))
})
