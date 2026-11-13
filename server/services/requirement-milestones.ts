import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Transaction } from '../db/client'
import { requirementMilestoneAssignees, requirementMilestones, requirementStatisticCoverage, requirementStatuses, requirements } from '../db/schema'
import { completeAfterObservation, milestoneForState, milestoneKinds, type MilestoneEvidence } from '../../shared/statistics/milestones'
import type { PropertySource, RequirementProperties } from '../../shared/requirements/properties'
import { readDocumentAssigneeIds } from './document-assignees'

type DocumentRow = typeof requirements.$inferSelect

async function databaseTime(tx: Transaction) {
  const [time] = await tx.execute<{ at: string }>(sql`select clock_timestamp()::timestamptz(3)::text as at`)
  return new Date(time!.at)
}

/** 创建服务在同一事务中提供可信初始属性；既有文档不得调用此函数补造初值。 */
export async function initializeMilestoneCoverage(tx: Transaction, row: DocumentRow, properties: RequirementProperties,
  source: PropertySource, operationId: string) {
  const kinds = milestoneKinds(row.documentType)
  if (!kinds.length) return
  const evidence: MilestoneEvidence = { type: 'creation', source, operationId, initialProperties: properties }
  await tx.insert(requirementStatisticCoverage).values(kinds.map(kind => ({
    projectId: row.projectId, requirementId: row.id, kind, capturedFrom: row.createdAt,
    historyComplete: true, completeFrom: row.createdAt, evidence,
  })))
}

/** 调用方持有文档行锁，并已写入本次操作最终的状态及完整负责人名单。 */
export async function recordRequirementMilestone(tx: Transaction, row: DocumentRow, statusId: string,
  source: PropertySource, operationId: string) {
  if (!milestoneKinds(row.documentType).length) return
  const status = await tx.query.requirementStatuses.findFirst({ where: eq(requirementStatuses.id, statusId) })
  const kind = milestoneForState(row.documentType, status!.code)
  if (!kind) return
  const occurredAt = await databaseTime(tx)
  const where = and(eq(requirementStatisticCoverage.requirementId, row.id), eq(requirementStatisticCoverage.kind, kind))
  let coverage = await tx.query.requirementStatisticCoverage.findFirst({ where })
  // 部署间隙或受控脚本直接创建的记录同样保持未知，不从当前状态推断初值。
  if (!coverage) {
    await tx.insert(requirementStatisticCoverage).values({ projectId: row.projectId, requirementId: row.id, kind,
      capturedFrom: occurredAt, historyComplete: false, gapReason: 'missing_initial_state',
      evidence: { type: 'legacy_without_initial_state', source: 'untracked', operationId: null } }).onConflictDoNothing()
    coverage = await tx.query.requirementStatisticCoverage.findFirst({ where })
  }
  const assigneeIds = await readDocumentAssigneeIds(tx, row.id)
  if (!coverage!.historyComplete) {
    // 保留旧缺口及第一次观察证据。观察之后不可能再发生这个“首次”事件，
    // 但观察前/当期仍不能给出完整数量，不能把观察写成正式里程碑。
    await tx.update(requirementStatisticCoverage).set({ observedAt: occurredAt,
      completeFrom: completeAfterObservation(occurredAt),
      observation: { statusCode: status!.code, assigneeIds, source, operationId },
    }).where(and(where, isNull(requirementStatisticCoverage.observedAt)))
    return
  }
  const inserted = await tx.insert(requirementMilestones).values({ projectId: row.projectId, requirementId: row.id,
    kind, occurredAt, source, operationId }).onConflictDoNothing().returning({ requirementId: requirementMilestones.requirementId })
  if (inserted.length && assigneeIds.length) await tx.insert(requirementMilestoneAssignees).values(
    assigneeIds.map(userId => ({ requirementId: row.id, kind, userId })),
  )
}
