import { z } from 'zod'
import { documentTemplateInputSchema } from '../../../shared/documents/templates'
import { requireAppContext } from '../../utils/request-context'
import { saveDocumentTemplate } from '../../services/document-templates'
import { documentWriteKey } from '../../services/document-write-receipts'
export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser, projectRoles } = await requireAppContext(event)
  const parsed = documentTemplateInputSchema.extend({ version: z.number().int().positive() }).safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: '模板信息或正文格式无效', data: { issues: parsed.error.issues } })
  const { version, ...input } = parsed.data
  return saveDocumentTemplate(db, { projectId, userId: currentUserId, admin: currentUser.role === 'admin' || projectRoles.includes('project_admin') }, input, getRouterParam(event, 'id')!, version, documentWriteKey(event))
})
