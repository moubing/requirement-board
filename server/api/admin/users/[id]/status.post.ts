import { changeAccountStatus } from '../../../../services/accounts'
import { requireSystemAdminContext } from '../../../../utils/request-context'
import { parseAccountInput, accountStatusSchema } from '../../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireSystemAdminContext(event)
  return changeAccountStatus(context, getRouterParam(event, 'id')!, parseAccountInput(accountStatusSchema, await readBody(event)))
})
