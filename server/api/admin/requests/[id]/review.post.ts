import { reviewAccessRequest } from '../../../../services/accounts'
import { requireSystemAdminContext } from '../../../../utils/request-context'
import { parseAccountInput, reviewSchema } from '../../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireSystemAdminContext(event)
  return reviewAccessRequest(context, getRouterParam(event, 'id')!, parseAccountInput(reviewSchema, await readBody(event)))
})
