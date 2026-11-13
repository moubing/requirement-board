import { z } from 'zod'
import { updateMemberRoles } from '../../../services/accounts'
import { requireAccountContext } from '../../../utils/request-context'
import { parseAccountInput, rolesSchema } from '../../../utils/account-input'

const schema = z.object({ roles: rolesSchema }).strict()
export default defineEventHandler(async (event) => {
  const context = await requireAccountContext(event)
  const { roles } = parseAccountInput(schema, await readBody(event))
  return updateMemberRoles(context, getRouterParam(event, 'id')!, roles)
})
