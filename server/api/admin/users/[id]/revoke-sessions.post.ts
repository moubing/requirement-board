import { revokeAccountSessions } from '../../../../services/accounts'
import { requireSystemAdminContext } from '../../../../utils/request-context'

export default defineEventHandler(async (event) => revokeAccountSessions(
  await requireSystemAdminContext(event), getRouterParam(event, 'id')!,
))
