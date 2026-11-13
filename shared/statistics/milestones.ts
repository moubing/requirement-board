import type { DocumentType } from '../documents/workflow'
import type { PropertySource, RequirementProperties } from '../requirements/properties'

export const MILESTONE_KINDS = ['first_testing', 'done'] as const
export type MilestoneKind = typeof MILESTONE_KINDS[number]
export type MilestoneEvidence = {
  type: 'creation' | 'legacy_without_initial_state'
  source: PropertySource | 'migration' | 'untracked'
  operationId: string | null
  initialProperties?: RequirementProperties
} | {
  // 仅供用户明确授权的一次性历史补录；不等于找回了原始发生时间。
  type: 'manual_backfill'
  source: 'agent_takeover'
  operationId: string
  backfilledAt: string
  assigneeIds: string[]
  reason: string
}
export type MilestoneObservation = {
  statusCode: string
  assigneeIds: string[]
  source: PropertySource | 'migration' | 'untracked'
  operationId: string | null
}

export function milestoneKinds(type: DocumentType): readonly MilestoneKind[] {
  return type === 'requirement' ? MILESTONE_KINDS : type === 'defect' ? ['done'] : []
}

export function milestoneForState(type: DocumentType, statusCode: string): MilestoneKind | null {
  if (type === 'requirement' && statusCode === 'testing') return 'first_testing'
  if ((type === 'requirement' || type === 'defect') && statusCode === 'done') return 'done'
  return null
}

/** 所有写入事实统一毫秒精度；旧文档的首次事件只可确定不晚于观察时点。 */
export function completeAfterObservation(observedAt: Date): Date {
  return new Date(observedAt.getTime() + 1)
}
