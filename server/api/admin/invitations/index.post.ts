import { createInvitation } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'
import { parseAccountInput, invitationInputSchema } from '../../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireSystemAdminContext(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return createInvitation(context, parseAccountInput(invitationInputSchema, await readBody(event)))
})
