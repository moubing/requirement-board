import { z } from 'zod'
import { DOCUMENT_TYPES, type DocumentType } from '../documents/workflow'

const queryInteger = (maximum: number) => z.union([z.string().regex(/^\d+$/), z.number()])
  .transform(Number).pipe(z.number().int().min(1).max(maximum))
const identifier = z.string().min(1).max(160)
const filterShape = {
  q: z.string().max(240).trim().default(''),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  statusId: identifier.optional(),
  assignee: identifier.optional(),
  /** 提出人：me 或成员 ID。 */
  reporter: identifier.optional(),
  /** 1 表示只看停滞文档，阈值见 shared/workbench/home.ts。 */
  stale: z.enum(['1']).optional(),
  excludeId: identifier.optional(),
}
export const REQUIREMENT_SORT_KEYS = ['key', 'title', 'documentType', 'status', 'priority', 'assignees', 'reporter', 'createdAt', 'updatedAt'] as const
export type RequirementSortKey = typeof REQUIREMENT_SORT_KEYS[number]

export const requirementFilterSchema = z.object(filterShape).strict()
export const requirementPageQuerySchema = requirementFilterSchema.extend({
  page: queryInteger(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: queryInteger(100).default(20),
  sortBy: z.enum(REQUIREMENT_SORT_KEYS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
}).refine(value => Number.isSafeInteger((value.page - 1) * value.pageSize), '分页范围过大')
  .refine(value => !value.sortOrder || value.sortBy, '指定排序方向时必须指定排序字段')

const idList = z.preprocess(value => typeof value === 'string' ? value.split(',') : value,
  z.array(identifier).max(20).transform(ids => [...new Set(ids)]))
export const requirementSearchQuerySchema = z.object({
  q: z.string().max(240).trim().default(''),
  limit: queryInteger(20).default(20),
  recentIds: idList.default([]),
}).strict()
export const requirementSummariesQuerySchema = z.object({ ids: idList.refine(ids => ids.length > 0, '请选择文档') }).strict()

export type RequirementFilters = z.output<typeof requirementFilterSchema>
export type RequirementPageQuery = z.output<typeof requirementPageQuerySchema>
export type RequirementSearchQuery = z.output<typeof requirementSearchQuerySchema>

export interface RequirementSummaryPerson { id: string; name: string; avatarColor: string }
export interface RequirementSummaryStatus { id: string; code: string; name: string; color: string }
export interface RequirementSummary {
  id: string
  key: string
  title: string
  documentType: DocumentType
  priority: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt: string
  reporter: RequirementSummaryPerson
  status: RequirementSummaryStatus
  assigneeIds: string[]
  assignees: RequirementSummaryPerson[]
}
export interface RequirementPage {
  items: RequirementSummary[]
  total: number
  page: number
  pageSize: number
  asOf: string
}
export interface RequirementGroups {
  groups: (RequirementSummaryStatus & { count: number })[]
  total: number
  asOf: string
}
export interface RequirementSearchResult { items: RequirementSummary[]; hasMore: boolean; asOf: string }
export interface RequirementSummariesResult {
  items: RequirementSummary[]
  requestedIds: string[]
  unavailableIds: string[]
  complete: true
  asOf: string
}
