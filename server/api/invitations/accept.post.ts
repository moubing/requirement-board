import { acceptInvitation } from '../../services/accounts'
import { limitAccountRequest } from '../../services/account-rate-limit'
import { requireAccountContext } from '../../utils/request-context'
import { parseAccountInput, tokenInputSchema } from '../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireAccountContext(event)
  await limitAccountRequest(event, 'invite-accept', 15, context.currentUserId)
  const { token } = parseAccountInput(tokenInputSchema, await readBody(event))
  return acceptInvitation(context, token)
})
