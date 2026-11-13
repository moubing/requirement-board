import { readInvitationLink } from '../../../../services/accounts'
import { requireSystemAdminContext } from '../../../../utils/request-context'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const context = await requireSystemAdminContext(event)
  return readInvitationLink(context, getRouterParam(event, 'id')!)
})
