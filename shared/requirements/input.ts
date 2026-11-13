import { z } from 'zod'
import { DOCUMENT_TYPES } from '../documents/workflow'
import { requirementPropertyPatchSchema } from './properties'

export const createRequirementSchema = requirementPropertyPatchSchema.extend({
  title: z.string().trim().min(1, '请输入文档标题').max(240, '标题最多 240 个字符'),
  documentType: z.enum(DOCUMENT_TYPES).default('requirement'),
  templateId: z.string().min(1).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})
