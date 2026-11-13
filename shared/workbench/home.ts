import { z } from 'zod'
import type { DocumentType } from '../documents/workflow'
import type { RequirementSummaryPerson, RequirementSummaryStatus } from '../requirements/query'
import { shanghaiDate, shiftDay } from '../statistics/workbench'

/** 首页工作流的三列；说明的状态与这三列不对应，不进入工作流和关键数字。 */
export const FLOW_STATES = ['queued', 'doing', 'testing'] as const
export type FlowState = typeof FLOW_STATES[number]
/** 工作流卡片菜单可选的全部状态。 */
export const TASK_FLOW_STATES = ['queued', 'doing', 'testing', 'done', 'closed'] as const
export type TaskFlowState = typeof TASK_FLOW_STATES[number]
export type FlowDocumentType = Exclude<DocumentType, 'instruction'>

/**
 * 停滞阈值（天）：距最近一次有效活动（创建、正文编辑、状态变化、保存正式版本）超过阈值提醒，超过两倍警示。
 * 集中配置，服务端筛选与页面显示共用；上线后按使用情况调整。
 */
export const STALE_DAYS: Record<FlowState, number> = { queued: 14, doing: 3, testing: 3 }
const DAY = 86_400_000
export type StaleLevel = 'warn' | 'danger' | null
export function staleLevel(code: string, lastActivityAt: string, now: string): StaleLevel {
  if (!(FLOW_STATES as readonly string[]).includes(code)) return null
  const limit = STALE_DAYS[code as FlowState] * DAY, idle = Date.parse(now) - Date.parse(lastActivityAt)
  return idle > limit * 2 ? 'danger' : idle > limit ? 'warn' : null
}
export function idleDays(lastActivityAt: string, now: string) {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(lastActivityAt)) / DAY))
}

export interface WorkbenchFlowCard {
  id: string
  key: string
  title: string
  documentType: FlowDocumentType
  priority: 'low' | 'medium' | 'high'
  status: RequirementSummaryStatus
  reporter: RequirementSummaryPerson
  assignees: RequirementSummaryPerson[]
  /** 最近一次有效活动；仅修改标题、负责人或优先级不会更新。 */
  lastActivityAt: string
  /** 我是负责人之一。 */
  mine: boolean
  /** 我提出且处于测试中，不论负责人是谁。 */
  verify: boolean
}
export interface WorkbenchFlow {
  asOf: string
  me: { id: string; name: string }
  /** 按状态代码给出本项目的状态 ID，供拖拽与菜单提交。 */
  statuses: Record<TaskFlowState, RequirementSummaryStatus>
  cards: WorkbenchFlowCard[]
  /** 与列表筛选一致的数量：我负责的各列、等我验证、我负责的停滞。 */
  counts: Record<FlowState, number> & { verify: number; stale: number }
  /** 卡片超过上限时只返回最该处理的部分，数量仍是全部。 */
  truncated: boolean
}
export const FLOW_CARD_LIMIT = 300

export const ACTIVITY_FILTERS = ['all', 'status', 'assignee', 'create', 'revision'] as const
export type ActivityFilter = typeof ACTIVITY_FILTERS[number]
export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = { all: '全部', status: '状态', assignee: '指派', create: '新建', revision: '版本' }
export type ActivityKind = 'create' | 'status' | 'assignee' | 'priority' | 'revision'
export const activityQuerySchema = z.object({
  kind: z.enum(ACTIVITY_FILTERS).default('all'),
  cursor: z.string().max(300).optional(),
  limit: z.union([z.string().regex(/^\d+$/), z.number()]).transform(Number).pipe(z.number().int().min(1).max(50)).default(30),
}).strict()
export type ActivityQuery = z.output<typeof activityQuerySchema>
export interface WorkbenchActivityEvent {
  id: string
  kind: ActivityKind
  at: string
  actor: RequirementSummaryPerson
  document: { id: string; key: string; title: string; documentType: DocumentType }
  /** 我负责、我提出或这次指派给了我。 */
  mine: boolean
  from?: { label: string; color: string | null }
  to?: { label: string; color: string | null }
  assignees?: { id: string; name: string }[]
  version?: number
}
export interface WorkbenchActivityPage { items: WorkbenchActivityEvent[]; nextCursor: string | null; asOf: string }

export interface WorkbenchTeamLoadRow {
  /** 成员 ID；未指派行为 unassigned。 */
  id: string
  name: string
  avatarColor: string | null
  counts: Record<FlowState, number>
}
export interface WorkbenchTeamLoad { asOf: string; statuses: RequirementSummaryStatus[]; rows: WorkbenchTeamLoadRow[] }

export const COMPLETION_WEEKS = 12
export const completionQuerySchema = z.object({ scope: z.enum(['team', 'mine']).default('team') }).strict()
export type CompletionScope = z.output<typeof completionQuerySchema>['scope']
export interface WorkbenchCompletion { id: string; key: string; title: string; documentType: FlowDocumentType; date: string; completedAt: string }
export interface WorkbenchCompletions {
  asOf: string
  scope: CompletionScope
  /** 上海时区的今天与窗口第一天（周一）。 */
  today: string
  startDate: string
  /** 第一条属性日志所在日期；之前的完成没有日志，不推测。 */
  dataStart: string
  items: WorkbenchCompletion[]
}
/** 近 COMPLETION_WEEKS 周，按周一对齐的第一天。 */
export function completionWindowStart(today: string) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  return shiftDay(today, -weekday - (COMPLETION_WEEKS - 1) * 7)
}
export { shanghaiDate, shiftDay }
