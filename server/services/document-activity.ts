import { sql, type SQL } from 'drizzle-orm'
import { requirements } from '../db/schema'
import { FLOW_STATES, STALE_DAYS } from '../../shared/workbench/home'

/** 微秒精度的 UTC ISO 文本，JS 与分页游标都能无损往返。 */
export const isoText = (value: SQL) => sql<string>`to_char(${value} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** 不进入动态与统计的属性日志来源。 */
export const counted = (log: SQL) => sql`${log}.detail->>'source' is distinct from 'migration'`

/**
 * 文档最近一次有效活动：创建、正文编辑、保存正式版本、状态变化（迁移日志除外）。
 * 仅修改标题、负责人或优先级不重置停滞计时；编辑收据须包含正文节点，忽略仅 $title 或空收据。
 * 依赖当前查询中的 requirements 表。
 */
export const lastActivityAt = sql<string>`greatest(${requirements.createdAt},
  (select max(edit.created_at) from requirement_edit_events edit where edit.requirement_id = ${requirements.id}
    and cardinality(array_remove(edit.block_ids, '$title')) > 0),
  (select max(revision.created_at) from requirement_revisions revision where revision.requirement_id = ${requirements.id}),
  (select max(log.created_at) from audit_events log where log.project_id = ${requirements.projectId} and log.target_id = ${requirements.id}
    and log.action = 'requirement.property.change' and log.detail->>'field' = 'statusId' and ${counted(sql`log`)}))`

/** 处于工作流状态且超过该状态阈值；与首页停滞提醒使用同一时钟（事务时间）。 */
export const isStale = sql`exists (select 1 from requirement_statuses stale_status where stale_status.id = ${requirements.statusId} and (${sql.join(
  FLOW_STATES.map(code => sql`(stale_status.code = ${code} and ${lastActivityAt} < now() - make_interval(days => ${STALE_DAYS[code]}))`),
  sql` or `)}))`
