import { and, asc, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm'
import { createError } from 'h3'
import type { Database, Transaction } from '../db/client'
import { projectMembers, requirementAssignees, requirements, requirementStatuses, users } from '../db/schema'
import { withDocumentAssignees } from './document-assignees'
import { counted, isoText, isStale, lastActivityAt } from './document-activity'
import { orderRequirementAssignees } from '../../shared/requirements/search'
import type { RequirementSummaryStatus } from '../../shared/requirements/query'
import { shanghaiMidnight } from '../../shared/statistics/workbench'
import {
  completionWindowStart, FLOW_CARD_LIMIT, FLOW_STATES, shanghaiDate, TASK_FLOW_STATES,
  type ActivityKind, type ActivityQuery, type CompletionScope, type FlowDocumentType, type FlowState, type TaskFlowState,
  type WorkbenchActivityPage, type WorkbenchCompletions, type WorkbenchFlow, type WorkbenchTeamLoad,
} from '../../shared/workbench/home'

type Snapshot = { tx: Transaction; asOf: string }
function readSnapshot<T>(db: Database, read: (snapshot: Snapshot) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const [clock] = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`)
    return read({ tx, asOf: new Date(clock!.at).toISOString() })
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

async function flowStatuses(tx: Transaction, projectId: string) {
  const rows = await tx.select({ id: requirementStatuses.id, code: requirementStatuses.code, name: requirementStatuses.name, color: requirementStatuses.color })
    .from(requirementStatuses).where(and(eq(requirementStatuses.projectId, projectId), eq(requirementStatuses.active, true),
      inArray(requirementStatuses.code, [...TASK_FLOW_STATES])))
  const byCode = Object.fromEntries(rows.map(row => [row.code, row])) as Record<TaskFlowState, RequirementSummaryStatus>
  if (TASK_FLOW_STATES.some(code => !byCode[code])) throw createError({ statusCode: 500, message: '项目缺少工作流状态' })
  return byCode
}

const assignedTo = (tx: Transaction, userId: string) => exists(tx.select({ one: sql`1` }).from(requirementAssignees)
  .where(and(eq(requirementAssignees.requirementId, requirements.id), eq(requirementAssignees.userId, userId))))

/** 我负责的未完成文档，加上我提出、处于测试中等我验证的文档。 */
export function readWorkbenchFlow(db: Database, projectId: string, currentUserId: string): Promise<WorkbenchFlow> {
  return readSnapshot(db, async ({ tx, asOf }) => {
    const statuses = await flowStatuses(tx, projectId)
    const me = await tx.query.users.findFirst({ where: eq(users.id, currentUserId), columns: { id: true, name: true } })
    const mine = assignedTo(tx, currentUserId)
    const flowIds = FLOW_STATES.map(code => statuses[code].id)
    const verify = and(eq(requirements.reporterId, currentUserId), eq(requirements.statusId, statuses.testing.id))!
    const scope = and(eq(requirements.projectId, projectId), inArray(requirements.statusId, flowIds), or(mine, verify))!
    const [counts] = await tx.select({
      ...Object.fromEntries(FLOW_STATES.map(code => [code,
        sql<number>`count(*) filter (where ${requirements.statusId} = ${statuses[code].id} and ${mine})::int`])) as Record<FlowState, SQL.Aliased<number> | SQL<number>>,
      verify: sql<number>`count(*) filter (where ${verify})::int`,
      stale: sql<number>`count(*) filter (where ${mine} and ${isStale})::int`,
      total: sql<number>`count(*)::int`,
    }).from(requirements).where(scope)
    // 超过上限时优先保留最久没有进展的文档。
    const rows = await tx.select({
      id: requirements.id, key: requirements.key, title: requirements.title, documentType: requirements.documentType,
      priority: requirements.priority, statusId: requirements.statusId, lastActivityAt: isoText(lastActivityAt),
      reporter: { id: users.id, name: users.name, avatarColor: users.avatarColor },
      mine: sql<boolean>`${mine}`,
    }).from(requirements).innerJoin(users, eq(users.id, requirements.reporterId)).where(scope)
      .orderBy(asc(lastActivityAt), asc(sql`${requirements.id} collate "C"`)).limit(FLOW_CARD_LIMIT)
    const byId = new Map(Object.values(statuses).map(status => [status.id, status]))
    const { total, ...rest } = counts!
    return { asOf, me: me ?? { id: currentUserId, name: '' }, statuses, counts: rest, truncated: total > rows.length,
      cards: (await withDocumentAssignees(tx, rows)).map(({ statusId, assigneeIds: _ids, ...row }) => ({ ...row,
        documentType: row.documentType as FlowDocumentType, priority: row.priority as WorkbenchFlow['cards'][number]['priority'],
        status: byId.get(statusId)!, lastActivityAt: new Date(row.lastActivityAt).toISOString(),
        assignees: orderRequirementAssignees(row.assignees),
        verify: row.reporter.id === currentUserId && statusId === statuses.testing.id })) }
  })
}

const PROPERTY_FIELDS: Record<ActivityQuery['kind'], string[]> = {
  all: ['statusId', 'assigneeIds', 'priority'], status: ['statusId'], assignee: ['assigneeIds'], create: [], revision: [],
}
type ActivityRow = {
  id: string; kind: ActivityKind; at_text: string; detail: Record<string, unknown> | null
  actor_id: string; actor_name: string; actor_color: string
  document_id: string; document_key: string; document_title: string; document_type: string; reporter_id: string; assigned_to_me: boolean
}
type LoggedValue = { value?: unknown; label?: string } | undefined
function decodeCursor(cursor: string) {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [unknown, unknown]
    if (typeof at === 'string' && typeof id === 'string' && Number.isFinite(Date.parse(at))) return { at, id }
  } catch {}
  throw createError({ statusCode: 400, message: '动态分页位置无效' })
}

/** 全项目动态：属性变化来自属性日志（迁移日志除外），新建来自文档，正式版本来自 v2 起的版本。 */
export function readWorkbenchActivity(db: Database, projectId: string, currentUserId: string, query: ActivityQuery): Promise<WorkbenchActivityPage> {
  return readSnapshot(db, async ({ tx, asOf }) => {
    const parts: ReturnType<typeof sql>[] = []
    const fields = PROPERTY_FIELDS[query.kind]
    if (fields.length) parts.push(sql`select 'p_' || log.id as id,
        case log.detail->>'field' when 'statusId' then 'status' when 'assigneeIds' then 'assignee' else 'priority' end as kind,
        log.created_at as at, log.actor_id, log.target_id as requirement_id, log.detail
      from audit_events log where log.project_id = ${projectId} and log.action = 'requirement.property.change'
        and log.detail->>'field' in (${sql.join(fields.map(field => sql`${field}`), sql`, `)}) and ${counted(sql`log`)}`)
    if (query.kind === 'all' || query.kind === 'create') parts.push(sql`select 'c_' || created.id as id, 'create'::text as kind, created.created_at as at,
        created.reporter_id as actor_id, created.id as requirement_id, null::jsonb as detail from requirements created where created.project_id = ${projectId}`)
    if (query.kind === 'all' || query.kind === 'revision') parts.push(sql`select 'v_' || revision.id as id, 'revision'::text as kind, revision.created_at as at,
        revision.author_id as actor_id, revision.requirement_id as requirement_id, jsonb_build_object('version', revision.version) as detail
      from requirement_revisions revision join requirements owner on owner.id = revision.requirement_id
      where owner.project_id = ${projectId} and revision.version > 1`)
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined
    const rows = await tx.execute<ActivityRow>(sql`select event.id, event.kind, ${isoText(sql`event.at`)} as at_text, event.detail,
        actor.id as actor_id, actor.name as actor_name, actor.avatar_color as actor_color,
        document.id as document_id, document.key as document_key, document.title as document_title,
        document.document_type, document.reporter_id,
        exists (select 1 from requirement_assignees assignment where assignment.requirement_id = document.id and assignment.user_id = ${currentUserId}) as assigned_to_me
      from (${sql.join(parts, sql` union all `)}) event
      join users actor on actor.id = event.actor_id
      join requirements document on document.id = event.requirement_id and document.project_id = ${projectId}
      ${cursor ? sql`where (event.at, event.id collate "C") < (${cursor.at}::timestamptz, ${cursor.id} collate "C")` : sql``}
      order by event.at desc, event.id collate "C" desc limit ${query.limit + 1}`)
    const page = rows.slice(0, query.limit)
    const statusIds = new Set<string>(), userIds = new Set<string>()
    for (const row of page) {
      const detail = row.detail as { before?: LoggedValue; after?: LoggedValue } | null
      if (row.kind === 'status') for (const value of [detail?.before?.value, detail?.after?.value]) if (typeof value === 'string') statusIds.add(value)
      if (row.kind === 'assignee' && Array.isArray(detail?.after?.value)) for (const id of detail.after.value) userIds.add(String(id))
    }
    const statuses = statusIds.size ? await tx.select({ id: requirementStatuses.id, color: requirementStatuses.color }).from(requirementStatuses)
      .where(and(eq(requirementStatuses.projectId, projectId), inArray(requirementStatuses.id, [...statusIds]))) : []
    const people = userIds.size ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : []
    const colors = new Map(statuses.map(status => [status.id, status.color])), names = new Map(people.map(person => [person.id, person.name]))
    const items = page.map(row => {
      const detail = (row.detail ?? {}) as { before?: LoggedValue; after?: LoggedValue; version?: number }
      const value = (logged: LoggedValue) => ({ label: logged?.label ?? '', color: typeof logged?.value === 'string' ? colors.get(logged.value) ?? null : null })
      const assignees = row.kind === 'assignee' && Array.isArray(detail.after?.value)
        ? detail.after.value.map(id => ({ id: String(id), name: names.get(String(id)) ?? String(id) })) : undefined
      return {
        id: row.id, kind: row.kind, at: new Date(row.at_text).toISOString(),
        actor: { id: row.actor_id, name: row.actor_name, avatarColor: row.actor_color },
        document: { id: row.document_id, key: row.document_key, title: row.document_title, documentType: row.document_type as WorkbenchActivityPage['items'][number]['document']['documentType'] },
        mine: row.assigned_to_me || row.reporter_id === currentUserId || Boolean(assignees?.some(person => person.id === currentUserId)),
        ...(row.kind === 'status' || row.kind === 'priority' ? { from: value(detail.before), to: value(detail.after) } : {}),
        ...(assignees ? { assignees } : {}),
        ...(row.kind === 'revision' ? { version: Number(detail.version) } : {}),
      }
    })
    const last = page.at(-1)
    return { items, asOf, nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify([last.at_text, last.id])).toString('base64url') : null }
  })
}

/** 成员 × 工作流状态。多人负责的文档在每位负责人下各计一次。 */
export function readWorkbenchTeamLoad(db: Database, projectId: string, currentUserId: string): Promise<WorkbenchTeamLoad> {
  return readSnapshot(db, async ({ tx, asOf }) => {
    const statuses = await flowStatuses(tx, projectId)
    const codeById = new Map(FLOW_STATES.map(code => [statuses[code].id, code]))
    const counts = await tx.select({ statusId: requirements.statusId, userId: requirementAssignees.userId, count: sql<number>`count(*)::int` })
      .from(requirements).leftJoin(requirementAssignees, eq(requirementAssignees.requirementId, requirements.id))
      .where(and(eq(requirements.projectId, projectId), inArray(requirements.statusId, [...codeById.keys()])))
      .groupBy(requirements.statusId, requirementAssignees.userId)
    const members = await tx.select({ id: users.id, name: users.name, avatarColor: users.avatarColor })
      .from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, projectId), eq(users.banned, false)))
    const empty = () => Object.fromEntries(FLOW_STATES.map(code => [code, 0])) as Record<FlowState, number>
    const byUser = new Map<string, Record<FlowState, number>>()
    for (const row of counts) {
      const key = row.userId ?? 'unassigned', cell = byUser.get(key) ?? empty()
      cell[codeById.get(row.statusId)!] += row.count
      byUser.set(key, cell)
    }
    const total = (cells: Record<FlowState, number>) => FLOW_STATES.reduce((sum, code) => sum + cells[code], 0)
    const rows = members.map(member => ({ ...member, counts: byUser.get(member.id) ?? empty() }))
      .sort((a, b) => Number(b.id === currentUserId) - Number(a.id === currentUserId) || total(b.counts) - total(a.counts)
        || a.name.localeCompare(b.name, 'zh-CN') || (a.id < b.id ? -1 : 1))
    return { asOf, statuses: FLOW_STATES.map(code => statuses[code]),
      rows: [...rows, { id: 'unassigned', name: '未指派', avatarColor: null, counts: byUser.get('unassigned') ?? empty() }] }
  })
}

/**
 * 近 12 周每天进入已完成的文档。每篇只计最后一次进入已完成（且当前仍为已完成）；
 * 「我的」按完成那一刻的负责人统计。迁移日志不计入，没有日志的历史完成不推测。
 */
export function readWorkbenchCompletions(db: Database, projectId: string, currentUserId: string, scope: CompletionScope): Promise<WorkbenchCompletions> {
  return readSnapshot(db, async ({ tx, asOf }) => {
    const today = shanghaiDate(asOf), startDate = completionWindowStart(today)
    const property = (field: string) => sql`log.project_id = ${projectId} and log.action = 'requirement.property.change' and log.detail->>'field' = ${field} and ${counted(sql`log`)}`
    const [first] = await tx.execute<{ at: string | null }>(sql`select ${isoText(sql`min(log.created_at)`)} as at from audit_events log
      where log.project_id = ${projectId} and log.action = 'requirement.property.change' and ${counted(sql`log`)}`)
    const rows = await tx.execute<{ id: string; key: string; title: string; document_type: string; completed_at: string; assignee_ids: string[] | null }>(sql`
      with completed as (
        select log.target_id as requirement_id, max(log.created_at) as completed_at
        from audit_events log join requirement_statuses target on target.id = log.detail->'after'->>'value'
        where ${property('statusId')} and target.code = 'done'
        group by log.target_id
      )
      select document.id, document.key, document.title, document.document_type, ${isoText(sql`completed.completed_at`)} as completed_at,
        coalesce(
          (select log.detail->'after'->'value' from audit_events log where ${property('assigneeIds')} and log.target_id = document.id
            and log.created_at <= completed.completed_at order by log.created_at desc, log.id desc limit 1),
          (select log.detail->'before'->'value' from audit_events log where ${property('assigneeIds')} and log.target_id = document.id
            and log.created_at > completed.completed_at order by log.created_at asc, log.id asc limit 1),
          (select jsonb_agg(assignment.user_id) from requirement_assignees assignment where assignment.requirement_id = document.id)
        ) as assignee_ids
      from completed join requirements document on document.id = completed.requirement_id and document.project_id = ${projectId}
      join requirement_statuses current_status on current_status.id = document.status_id and current_status.code = 'done'
      where completed.completed_at >= ${shanghaiMidnight(startDate)}::timestamptz
      order by completed.completed_at desc, document.id collate "C"`)
    return { asOf, scope, today, startDate, dataStart: first?.at ? shanghaiDate(new Date(first.at)) : today,
      items: rows.filter(row => scope === 'team' || (row.assignee_ids ?? []).includes(currentUserId)).map(row => {
        const completedAt = new Date(row.completed_at).toISOString()
        return { id: row.id, key: row.key, title: row.title, documentType: row.document_type as FlowDocumentType, completedAt, date: shanghaiDate(completedAt) }
      }) }
  })
}
