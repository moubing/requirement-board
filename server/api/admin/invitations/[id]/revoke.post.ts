import { revokeInvitation } from '../../../../services/accounts'
import { requireSystemAdminContext } from '../../../../utils/request-context'

export default defineEventHandler(async (event) => revokeInvitation(
  await requireSystemAdminContext(event), getRouterParam(event, 'id')!,
))
