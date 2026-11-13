import { and, asc, count, desc, eq, exists, inArray, like, ne, not, or, sql, type SQL } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client'
import { requirementAssignees, requirements, requirementStatuses, users } from '../db/schema'
import { withDocumentAssignees } from './document-assignees'
import { isStale } from './document-activity'
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES } from '../../shared/documents/workflow'
import { normalizeRequirementNumber, normalizeRequirementSearch, orderRequirementAssignees,
  REQUIREMENT_SEARCH_WHITESPACE, requirementSearchTerms } from '../../shared/requirements/search'
import type { RequirementFilters, RequirementGroups, RequirementPage, RequirementPageQuery,
  RequirementSearchQuery, RequirementSearchResult, RequirementSummary, RequirementSummariesResult } from '../../shared/requirements/query'

// 固定 UTF-8/ICU 根语言规则，保持 NFKC 和 Unicode 小写与 shared 实现一致。
const normalizedTitle = sql`btrim(lower(normalize(${requirements.title}, NFKC) collate "und-x-icu"), ${REQUIREMENT_SEARCH_WHITESPACE})`
const normalizedKey = sql`translate(lower(normalize(${requirements.key}, NFKC) collate "und-x-icu"), ${REQUIREMENT_SEARCH_WHITESPACE + '_-'}, '')`
const numberKey = sql`coalesce(substring(${requirements.key} from '^REQ-([0-9]+)$')::numeric, 0)`
const displayType = sql`case ${sql.join(DOCUMENT_TYPES.map(type => sql`when ${requirements.documentType} = ${type} then ${DOCUMENT_TYPE_LABELS[type]}`), sql` `)} else ${requirements.documentType} end`
const assigneeText = sql`coalesce((select string_agg(person.name, '、' order by person.name collate "C", person.id collate "C")
  from requirement_assignees assignment join users person on person.id = assignment.user_id
  where assignment.requirement_id = ${requirements.id}), '')`
const escapeLike = (value: string) => value.replace(/[\\%_]/g, character => '\\' + character)

function matchesQuery(q: string): SQL | undefined {
  return and(...requirementSearchTerms(q).map(token => or(
    like(normalizedKey, `%${escapeLike(normalizeRequirementNumber(token))}%`),
    like(normalizedTitle, `%${escapeLike(token)}%`),
  )!))
}

function relevance(q: string) {
  return sql<number>`case when ${normalizedKey} = ${normalizeRequirementNumber(q)} then 0
    when ${normalizedKey} like ${escapeLike(normalizeRequirementNumber(q)) + '%'} then 1
    when ${normalizedTitle} like ${escapeLike(normalizeRequirementSearch(q)) + '%'} then 2 else 3 end`
}

function filters(tx: Transaction, projectId: string, currentUserId: string, query: RequirementFilters) {
  const assigned = tx.select({ one: sql`1` }).from(requirementAssignees)
    .where(and(eq(requirementAssignees.requirementId, requirements.id), query.assignee && query.assignee !== 'unassigned'
      ? eq(requirementAssignees.userId, query.assignee === 'me' ? currentUserId : query.assignee) : undefined))
  return and(eq(requirements.projectId, projectId), matchesQuery(query.q),
    query.documentType ? eq(requirements.documentType, query.documentType) : undefined,
    query.statusId ? eq(requirements.statusId, query.statusId) : undefined,
    query.excludeId ? ne(requirements.id, query.excludeId) : undefined,
    query.reporter ? eq(requirements.reporterId, query.reporter === 'me' ? currentUserId : query.reporter) : undefined,
    query.stale ? isStale : undefined,
    query.assignee ? (query.assignee === 'unassigned' ? not(exists(assigned)) : exists(assigned)) : undefined)!
}

function ordering(query: RequirementPageQuery): SQL[] {
  if (!query.sortBy) return normalizeRequirementSearch(query.q)
    ? [asc(relevance(query.q)), desc(requirements.updatedAt), asc(sql`${requirements.id} collate "C"`)]
    : [desc(requirements.updatedAt), desc(numberKey), asc(sql`${requirements.id} collate "C"`)]
  const columns = {
    key: numberKey,
    title: sql`${requirements.title} collate "C"`,
    documentType: sql`(${displayType}) collate "C"`,
    status: sql`${requirementStatuses.name} collate "C"`,
    priority: sql`case ${requirements.priority} when 'low' then 0 when 'medium' then 1 when 'high' then 2 else -1 end`,
    assignees: sql`(${assigneeText}) collate "C"`,
    reporter: sql`${users.name} collate "C"`,
    createdAt: requirements.createdAt,
    updatedAt: requirements.updatedAt,
  }
  return [(query.sortOrder === 'desc' ? desc : asc)(columns[query.sortBy]), asc(sql`${requirements.id} collate "C"`)]
}

async function readSnapshot<T>(db: Database, read: (tx: Transaction, asOf: string) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const [clock] = await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`)
    return read(tx, new Date(clock!.at).toISOString())
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

async function summaries(tx: Transaction, where: SQL, order: SQL[], limit: number, offset = 0): Promise<RequirementSummary[]> {
  const rows = await tx.select({
    id: requirements.id, key: requirements.key, title: requirements.title, documentType: requirements.documentType,
    priority: requirements.priority, createdAt: requirements.createdAt, updatedAt: requirements.updatedAt,
    status: { id: requirementStatuses.id, code: requirementStatuses.code, name: requirementStatuses.name, color: requirementStatuses.color },
    reporter: { id: users.id, name: users.name, avatarColor: users.avatarColor },
  }).from(requirements).innerJoin(requirementStatuses, eq(requirementStatuses.id, requirements.statusId))
    .innerJoin(users, eq(users.id, requirements.reporterId)).where(where).orderBy(...order).limit(limit).offset(offset)
  return (await withDocumentAssignees(tx, rows)).map(row => ({ ...row,
    priority: row.priority as RequirementSummary['priority'],
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    assignees: orderRequirementAssignees(row.assignees),
  }))
}

/** S3 迁移完全部消费者后接入 GET /api/requirements；不增加全量或临时分页 HTTP 后门。 */
export async function listRequirementPage(db: Database, projectId: string, currentUserId: string, query: RequirementPageQuery): Promise<RequirementPage> {
  return readSnapshot(db, async (tx, asOf) => {
    const where = filters(tx, projectId, currentUserId, query)
    const [matched] = await tx.select({ total: count() }).from(requirements).where(where)
    const items = await summaries(tx, where, ordering(query), query.pageSize, (query.page - 1) * query.pageSize)
    return { items, total: matched!.total, page: query.page, pageSize: query.pageSize, asOf }
  })
}

export async function groupRequirements(db: Database, projectId: string, currentUserId: string, query: RequirementFilters): Promise<RequirementGroups> {
  return readSnapshot(db, async (tx, asOf) => {
    const statuses = await tx.select({ id: requirementStatuses.id, code: requirementStatuses.code, name: requirementStatuses.name, color: requirementStatuses.color })
      .from(requirementStatuses).where(and(eq(requirementStatuses.projectId, projectId), eq(requirementStatuses.active, true)))
      .orderBy(asc(requirementStatuses.sortOrder), asc(sql`${requirementStatuses.id} collate "C"`))
    const counts = await tx.select({ statusId: requirements.statusId, count: count() }).from(requirements)
      .where(filters(tx, projectId, currentUserId, query)).groupBy(requirements.statusId)
    const byStatus = new Map(counts.map(row => [row.statusId, row.count]))
    return { groups: statuses.map(status => ({ ...status, count: byStatus.get(status.id) ?? 0 })),
      total: counts.reduce((total, row) => total + row.count, 0), asOf }
  })
}

export async function searchRequirementSummaries(db: Database, projectId: string, query: RequirementSearchQuery): Promise<RequirementSearchResult> {
  return readSnapshot(db, async (tx, asOf) => {
    if (!normalizeRequirementSearch(query.q)) return { items: [], hasMore: false, asOf }
    const recentOrder = query.recentIds.length ? [asc(sql`case ${sql.join(query.recentIds.map((id, index) => sql`when ${requirements.id} = ${id} then ${index}`), sql` `)} else ${query.recentIds.length} end`)] : []
    const rows = await summaries(tx, and(eq(requirements.projectId, projectId), matchesQuery(query.q))!,
      [asc(relevance(query.q)), ...recentOrder, desc(requirements.updatedAt), asc(sql`${requirements.id} collate "C"`)], query.limit + 1)
    return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit, asOf }
  })
}

export async function readRequirementSummaries(db: Database, projectId: string, ids: string[]): Promise<RequirementSummariesResult> {
  return readSnapshot(db, async (tx, asOf) => {
    const requestedIds = [...new Set(ids)]
    const rows = await summaries(tx, and(eq(requirements.projectId, projectId), inArray(requirements.id, requestedIds))!, [], requestedIds.length)
    const byId = new Map(rows.map(row => [row.id, row]))
    return { items: requestedIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), requestedIds,
      unavailableIds: requestedIds.filter(id => !byId.has(id)), complete: true, asOf }
  })
}
