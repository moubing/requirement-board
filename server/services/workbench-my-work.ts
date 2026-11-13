import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { Database } from '../db/client'
import { DOCUMENT_STATES, type DocumentState } from '../../shared/documents/workflow'
import { shanghaiDate, shanghaiMidnight, shiftDay, STATISTICS_TIME_ZONE, workPeriodDates, WORK_METRICS,
  type CurrentWorkState, type MyWorkStatistics, type WorkMetric, type WorkQuery, type WorkValues } from '../../shared/statistics/workbench'

const metricSources = [
  ['createdRequirements', 'requirement', 'created'], ['firstTestingRequirements', 'requirement', 'first_testing'],
  ['completedRequirements', 'requirement', 'done'], ['createdDefects', 'defect', 'created'], ['completedDefects', 'defect', 'done'],
] as const
const currentCodes = {
  requirement: ['queued', 'doing', 'testing'],
  defect: ['queued', 'doing', 'testing'],
} satisfies Record<string, DocumentState[]>

/** 所有数字与逐日数据取自同一个只读快照；不返回文档或历史负责人明细。 */
export function readMyWorkStatistics(db: Database, projectId: string, currentUserId: string, query: WorkQuery): Promise<MyWorkStatistics> {
  return db.transaction(async tx => {
    const [clock] = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::timestamptz(3)::text as at`)
    const asOf = new Date(clock!.at).toISOString(), today = shanghaiDate(asOf)
    const dates = workPeriodDates(query.period, query.date ?? today)
    const start = shanghaiMidnight(dates.startDate), end = shanghaiMidnight(dates.endDate)
    if (start > asOf) throw createError({ statusCode: 400, message: '不能查看尚未开始的统计周期' })
    const observedUntil = end < asOf ? end : asOf
    // 缺口检查覆盖项目内全部潜在历史归属。当前负责人不能证明历史事件不属于本人。
    const rows = await tx.execute<{ day: string; metric: WorkMetric; count: number; incomplete: boolean; complete_from: string | null }>(sql`
      with metrics(metric, document_type, kind) as (values ${sql.join(metricSources.map(values => sql`(${values[0]}::text, ${values[1]}::text, ${values[2]}::text)`), sql`, `)}),
      days(day, starts, ends) as (values ${sql.join(dates.days.map(day => sql`(${day}::text, ${shanghaiMidnight(day)}::timestamptz, ${shanghaiMidnight(shiftDay(day, 1))}::timestamptz)`), sql`, `)}),
      gaps as (
        select m.metric, r.created_at, c.complete_from from requirements r
        join metrics m on m.document_type = r.document_type and m.kind <> 'created'
        left join requirement_statistic_coverage c on c.requirement_id = r.id and c.kind = m.kind
        where r.project_id = ${projectId} and r.created_at < ${asOf}::timestamptz and not coalesce(c.history_complete, false)
      ),
      coverage as (
        select metric, case when bool_and(complete_from is not null) then max(complete_from) end as complete_from
        from gaps group by metric
      ),
      events as (
        select m.metric, r.created_at as occurred_at from requirements r
        join metrics m on m.document_type = r.document_type and m.kind = 'created'
        where r.project_id = ${projectId} and r.reporter_id = ${currentUserId}
          and r.created_at >= ${start}::timestamptz and r.created_at < ${observedUntil}::timestamptz
        union all
        select m.metric, e.occurred_at from requirement_milestones e
        join requirements r on r.id = e.requirement_id and r.project_id = e.project_id
        join metrics m on m.document_type = r.document_type and m.kind = e.kind
        where e.project_id = ${projectId} and e.occurred_at >= ${start}::timestamptz and e.occurred_at < ${observedUntil}::timestamptz
          and exists(select 1 from requirement_milestone_assignees a where a.requirement_id = e.requirement_id and a.kind = e.kind and a.user_id = ${currentUserId})
      )
      select d.day, m.metric, count(e.metric)::int as count,
        exists(select 1 from gaps g where g.metric = m.metric and g.created_at < least(d.ends, ${observedUntil}::timestamptz)
          and (g.complete_from is null or g.complete_from > d.starts)) as incomplete,
        c.complete_from::text
      from days d cross join metrics m left join coverage c on c.metric = m.metric
      left join events e on e.metric = m.metric and e.occurred_at >= d.starts and e.occurred_at < d.ends
      group by d.day, d.starts, d.ends, m.metric, c.complete_from order by d.day, m.metric
    `)
    const days = dates.days.map(date => ({ date, current: date === today, values: Object.fromEntries(WORK_METRICS.map(metric => {
      const row = rows.find(item => item.day === date && item.metric === metric)!
      const quality = date > today ? 'future' : row.incomplete ? 'incomplete' : 'complete'
      return [metric, { value: quality === 'complete' ? row.count : null, knownValue: quality === 'future' ? null : row.count, quality,
        completeFrom: row.complete_from ? new Date(row.complete_from).toISOString() : null,
        reason: quality === 'incomplete' ? 'missing_history' : quality === 'future' ? 'future' : null }]
    })) as WorkValues }))
    const totals = Object.fromEntries(WORK_METRICS.map(metric => {
      const values = days.map(day => day.values[metric]), incomplete = values.some(value => value.quality === 'incomplete')
      const knownValue = values.reduce((sum, value) => sum + (value.knownValue ?? 0), 0)
      return [metric, { value: incomplete ? null : knownValue, knownValue,
        quality: incomplete ? 'incomplete' : 'complete', completeFrom: values[0]!.completeFrom, reason: incomplete ? 'missing_history' : null }]
    })) as WorkValues
    const currentRows = await tx.execute<CurrentWorkState & { type: 'requirement' | 'defect'; [key: string]: unknown }>(sql`
      select r.document_type as type, s.code, s.name, s.color, count(*)::int as count
      from requirements r join requirement_statuses s on s.id = r.status_id and s.project_id = r.project_id
      where r.project_id = ${projectId} and r.document_type in ('requirement', 'defect') and s.code not in ('done', 'closed')
        and exists(select 1 from requirement_assignees a where a.requirement_id = r.id and a.user_id = ${currentUserId})
      group by r.document_type, s.code, s.name, s.color order by s.code collate "C"
    `)
    const states = (type: 'requirement' | 'defect'): CurrentWorkState[] => {
      const codes: string[] = currentCodes[type]
      return [...codes.map(code => {
        const found = currentRows.find(row => row.type === type && row.code === code)
        return { code, ...DOCUMENT_STATES[code as DocumentState], count: 0, ...found }
      }), ...currentRows.filter(row => row.type === type && !codes.includes(row.code))]
        .map(({ code, name, color, count }) => ({ code, name, color, count }))
    }
    const requirements = states('requirement'), defects = states('defect')
    return { asOf, timezone: STATISTICS_TIME_ZONE, period: { type: query.period, startDate: dates.startDate, endDate: dates.endDate,
      start, end, observedUntil, current: end > asOf }, totals, days,
    current: { developmentRequirements: requirements.find(row => row.code === 'doing')!.count,
      unfinishedDefects: defects.reduce((total, row) => total + row.count, 0), requirements, defects } }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
