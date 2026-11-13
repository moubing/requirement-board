import { z } from 'zod'

export const requirementPropertiesSchema = z.object({
  statusId: z.string().min(1),
  assigneeIds: z.array(z.string().min(1)).max(100).refine(ids => new Set(ids).size === ids.length, '负责人不能重复'),
  priority: z.enum(['low', 'medium', 'high']),
}).strict()
export const requirementPropertyPatchSchema = requirementPropertiesSchema.partial()
export type RequirementProperties = z.infer<typeof requirementPropertiesSchema>
export type RequirementPropertyPatch = z.infer<typeof requirementPropertyPatchSchema>
export const PROPERTY_LABELS = { statusId: '状态', assigneeIds: '负责人', priority: '优先级' } as const
export const PRIORITY_LABELS = { low: '低', medium: '中', high: '高' } as const
export type PropertyValue = { value: string | string[] | null; label: string }
export type PropertyChange = {
  field: keyof RequirementProperties | 'title'
  label: string
  before: PropertyValue
  after: PropertyValue
}
/** 业务写入来源；里程碑等统计只接受这些来源。 */
export type PropertySource = 'web' | 'agent_review' | 'agent_takeover'
/** 属性日志来源。migration 只由数据库迁移写入，在历史中显示为「系统迁移」，不进入动态与统计。 */
export type PropertyLogSource = PropertySource | 'migration'
export interface PropertyHistoryEntry extends PropertyChange {
  id: string
  operationId: string
  source: PropertyLogSource
  actor: { id: string; name: string }
  createdAt: string
}
