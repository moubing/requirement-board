import { useDatabase } from '../../db/client'
import { previewInvitation } from '../../services/accounts'
import { limitAccountRequest } from '../../services/account-rate-limit'
import { parseAccountInput, tokenInputSchema } from '../../utils/account-input'

export default defineEventHandler(async (event) => {
  await limitAccountRequest(event, 'invite-preview', 30)
  const { token } = parseAccountInput(tokenInputSchema, await readBody(event))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return previewInvitation(useDatabase(), token)
})
