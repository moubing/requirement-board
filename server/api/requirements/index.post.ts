import { eq } from 'drizzle-orm'
import { instantiateTemplate } from '../../../shared/documents/templates'
import { createEmptyDocument } from '../../../shared/editor/document'
import { getDocumentTemplate } from '../../services/document-templates'
import { createRequirementSchema } from '../../../shared/requirements/input'
import { requirements } from '../../db/schema'
import { requireAppContext } from '../../utils/request-context'
import { createRequirement } from '../../services/create-requirement'
import { withDocumentAssignees } from '../../services/document-assignees'
import { documentWriteKey, documentWriteReceipt } from '../../services/document-write-receipts'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const input = createRequirementSchema.safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: input.error.issues[0]?.message ?? '文档创建参数无效' })
  const { title, documentType, templateId, ...properties } = input.data
  const requestId = documentWriteKey(event)
  const result = await db.transaction(async tx => {
    const receipt = await documentWriteReceipt(tx, { projectId, userId: currentUserId }, requestId, 'requirement.create', input.data)
    if (receipt.resourceId) return { requirementId: receipt.resourceId }
    const template = templateId === null ? null : await getDocumentTemplate(tx, projectId, templateId ?? `builtin_${documentType}`)
    if (template && template.documentType !== documentType) throw createError({ statusCode: 400, message: '模板与文档类型不匹配' })
    const created = await createRequirement(tx, projectId, currentUserId,
      { title, documentType, properties, contentJson: template ? instantiateTemplate(template.contentJson) : createEmptyDocument(),
        changeNote: template ? `通过「${template.name}」创建文档` : '创建空白文档', initializeCollaboration: false })
    await receipt.complete(created.requirementId)
    return created
  })
  const row = await db.query.requirements.findFirst({ where: eq(requirements.id, result.requirementId),
    with: { status: true, reporter: true } })
  if (!row) throw createError({ statusCode: 410, message: '本次提交曾创建的文档已不存在，不能重复创建' })
  return (await withDocumentAssignees(db, [row]))[0]!
})
