import { addRelatedDocumentsSchema } from '../../../../../shared/requirements/relations'
import { changeRelatedDocuments } from '../../../../services/requirement-relations'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  const input = addRelatedDocumentsSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '请选择 1–100 篇有效文档' })
  return changeRelatedDocuments(db, projectId, getRouterParam(event, 'id')!, input.data.documentIds, 'add')
})
