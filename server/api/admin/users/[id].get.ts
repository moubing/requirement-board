import { managedUserDetail } from '../../../services/accounts'
import { requireSystemAdminContext } from '../../../utils/request-context'

export default defineEventHandler(async (event) => {
  const { db } = await requireSystemAdminContext(event)
  return managedUserDetail(db, getRouterParam(event, 'id')!)
})
