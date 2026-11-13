import { z } from 'zod'
import { requireAppContext } from '../../utils/request-context'
import { parseAccountInput } from '../../utils/account-input'
import { readWorkbenchTeamLoad } from '../../services/workbench-home'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  parseAccountInput(z.object({}).strict(), getQuery(event))
  setHeader(event, 'cache-control', 'no-store')
  return readWorkbenchTeamLoad(db, projectId, currentUserId)
})
