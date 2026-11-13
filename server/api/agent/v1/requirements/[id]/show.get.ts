import { z } from 'zod'
import { requireAgentContext } from '../../../../../services/agent-tokens'
import { showAgentVersion } from '../../../../../services/agent-history'
import { documentRefSchema, parseAgentQuery } from '../../../../../utils/agent-query'
export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const query = parseAgentQuery(z.object({ version: documentRefSchema.default('latest') }).strict(), getQuery(event))
  return showAgentVersion(db, projectId, getRouterParam(event, 'id')!, query.version)
})
