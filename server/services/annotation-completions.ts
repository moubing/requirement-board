import { and, eq, gt, isNotNull, lte, or, sql } from 'drizzle-orm'
import { ANNOTATION_COMPLETION_RETENTION_MS } from '../../shared/agent/annotation-completion'
import type { AnnotationCompletion } from '../../shared/agent/annotations'
import type { Database } from '../db/client'
import { agentSuggestions } from '../db/schema'

type CompletionScope = { projectId: string; requirementId: string; userId: string }
const completedAt = sql`coalesce(${agentSuggestions.reviewedAt}, ${agentSuggestions.createdAt})`
const cutoff = (now: number) => new Date(now - ANNOTATION_COMPLETION_RETENTION_MS)
function matching(scope: CompletionScope, annotations: AnnotationCompletion[]) {
  return and(
    eq(agentSuggestions.projectId, scope.projectId), eq(agentSuggestions.requirementId, scope.requirementId),
    eq(agentSuggestions.userId, scope.userId), eq(agentSuggestions.executionMode, 'takeover'), eq(agentSuggestions.status, 'applied'),
    or(...annotations.map(item => sql`${agentSuggestions.completedAnnotations} @> ${JSON.stringify([item])}::jsonb`)),
  )
}

export async function readAnnotationCompletions(db: Database, scope: CompletionScope, annotations: AnnotationCompletion[], now = Date.now()) {
  const rows = await db.select({ completed: agentSuggestions.completedAnnotations }).from(agentSuggestions)
    .where(and(matching(scope, annotations), gt(completedAt, cutoff(now).toISOString())))
  const requested = new Map(annotations.map(item => [item.id, item.fingerprint]))
  return [...new Map(rows.flatMap(row => (row.completed ?? [])
    .filter(item => requested.get(item.id) === item.fingerprint).map(item => [item.id, item] as const))).values()]
}

export async function acknowledgeAnnotationCompletions(db: Database, scope: CompletionScope, annotations: AnnotationCompletion[]) {
  // 单条 UPDATE 基于最新行移除交集，避免不同标签页的并发确认互相覆盖；空数组收为 NULL。
  await db.update(agentSuggestions).set({ completedAnnotations: sql`(
    select jsonb_agg(entry.value) from jsonb_array_elements(${agentSuggestions.completedAnnotations}) as entry(value)
    where not (${JSON.stringify(annotations)}::jsonb @> jsonb_build_array(entry.value))
  )` }).where(matching(scope, annotations))
}

export async function expireAnnotationCompletions(db: Database, now = Date.now()) {
  // applied 从成功时起保留 7 天；失败/取消/长期未完成的临时信息也会回收。
  // 仅清临时完成字段，不删除操作、请求哈希、正文、版本或其他审计信息。
  await db.update(agentSuggestions).set({ completedAnnotations: null }).where(and(
    isNotNull(agentSuggestions.completedAnnotations), lte(completedAt, cutoff(now).toISOString()),
  ))
}

export function liveAnnotationCompletions(operation: {
  status: string; reviewedAt: Date | null; createdAt: Date; completedAnnotations: AnnotationCompletion[] | null
}, now = Date.now()) {
  return operation.status === 'applied' && (operation.reviewedAt ?? operation.createdAt).getTime() > cutoff(now).getTime()
    ? operation.completedAnnotations ?? [] : []
}
