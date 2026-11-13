import { z } from 'zod'

export const STATISTICS_TIME_ZONE = 'Asia/Shanghai'
export const WORK_METRICS = ['createdRequirements', 'firstTestingRequirements', 'completedRequirements', 'createdDefects', 'completedDefects'] as const
export type WorkMetric = typeof WORK_METRICS[number]
export const WORK_METRIC_LABELS: Record<WorkMetric, string> = {
  createdRequirements: '创建需求', firstTestingRequirements: '首次提测需求', completedRequirements: '完成需求', createdDefects: '提出 Bug', completedDefects: '完成 Bug',
}
export type WorkPeriod = 'week' | 'month'
export interface WorkQuery { period: WorkPeriod; date?: string }
const validDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 1000
}
export const workQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate, '日期无效').optional(),
}).strict()

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: STATISTICS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
export function shanghaiDate(at: Date | string): string {
  const parts = dateFormatter.formatToParts(new Date(at))
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-')
}
export function shiftDay(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
// 用命名时区转换自然日，不能依赖服务器本地时区；也保留上海历史夏令时语义。
const clockFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: STATISTICS_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
export function shanghaiMidnight(date: string): string {
  const target = Date.parse(`${date}T00:00:00Z`)
  let candidate = target
  for (let index = 0; index < 4; index++) {
    const parts = Object.fromEntries(clockFormatter.formatToParts(candidate).map(part => [part.type, part.value]))
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`)
    const difference = local - target
    if (!difference) break
    candidate -= difference
  }
  return new Date(candidate).toISOString()
}
export function workPeriodDates(period: WorkPeriod, date: string) {
  const value = new Date(`${date}T00:00:00Z`)
  const startDate = period === 'week' ? shiftDay(date, -((value.getUTCDay() + 6) % 7)) : `${date.slice(0, 7)}-01`
  const nextMonth = new Date(`${startDate}T00:00:00Z`)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const endDate = period === 'week' ? shiftDay(startDate, 7) : nextMonth.toISOString().slice(0, 10)
  const days: string[] = []
  for (let day = startDate; day < endDate; day = shiftDay(day, 1)) days.push(day)
  return { startDate, endDate, days }
}
export interface WorkValue {
  value: number | null
  // 已确认事件数；历史缺失时只是下界，未来日期仍为 null。
  knownValue: number | null
  quality: 'complete' | 'incomplete' | 'future'
  completeFrom: string | null
  reason: 'missing_history' | 'future' | null
}
export function workValueNumber(item: WorkValue | null | undefined): number | null {
  if (!item || item.quality === 'future') return null
  if (item.quality === 'incomplete') return (item.knownValue ?? 0) > 0 ? item.knownValue : null
  return item.value
}
export function formatWorkValue(item: WorkValue | null | undefined): string {
  const value = workValueNumber(item)
  return value === null ? '—' : `${item?.quality === 'incomplete' ? '≥' : ''}${value}`
}
export type WorkValues = Record<WorkMetric, WorkValue>
export interface CurrentWorkState { code: string; name: string; color: string; count: number }
export interface MyWorkStatistics {
  asOf: string
  timezone: typeof STATISTICS_TIME_ZONE
  period: { type: WorkPeriod; startDate: string; endDate: string; start: string; end: string; observedUntil: string; current: boolean }
  totals: WorkValues
  days: { date: string; current: boolean; values: WorkValues }[]
  current: { developmentRequirements: number; unfinishedDefects: number; requirements: CurrentWorkState[]; defects: CurrentWorkState[] }
}
