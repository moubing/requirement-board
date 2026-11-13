import { addRelatedDocumentsSchema } from '../../../../../../../shared/requirements/relations'
import { requireAgentContext } from '../../../../../../services/agent-tokens'
import { changeAgentRelatedDocuments } from '../../../../../../services/agent-relations'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const input = addRelatedDocumentsSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '请选择 1–100 篇有效文档' })
  return changeAgentRelatedDocuments(db, projectId, getRouterParam(event, 'id')!, input.data.documentIds, 'add')
})
