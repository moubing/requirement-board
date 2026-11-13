import { accessRequestSchema } from '../../../shared/auth/account-input'
import { submitAccessRequest } from '../../services/accounts'
import { limitAccountRequest } from '../../services/account-rate-limit'
import { requireAccountContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'

export default defineEventHandler(async (event) => {
  const context = await requireAccountContext(event)
  await limitAccountRequest(event, 'application', 5, context.currentUserId)
  const input = parseAccountInput(accessRequestSchema, await readBody(event))
  return submitAccessRequest(context, input.message)
})
