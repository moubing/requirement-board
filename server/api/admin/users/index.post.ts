import { createManagedUser } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'
import { managedUserCreateSchema, parseAccountInput } from '../../../utils/account-input'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const context = await requireSystemAdminContext(event)
  return createManagedUser(context, parseAccountInput(managedUserCreateSchema, await readBody(event)))
})
