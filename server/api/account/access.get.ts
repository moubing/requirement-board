import { getAccountAccess } from '../../services/accounts'
import { requireAccountContext } from '../../utils/request-context'

export default defineEventHandler(async (event) => getAccountAccess(await requireAccountContext(event)))
