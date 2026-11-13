import { updateManagedUser } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'
import { parseAccountInput, userUpdateSchema } from '../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireSystemAdminContext(event)
  return updateManagedUser(context, getRouterParam(event, 'id')!, parseAccountInput(userUpdateSchema, await readBody(event)))
})
