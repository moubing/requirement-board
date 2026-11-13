export const DOCUMENT_TYPES = ['requirement', 'defect', 'instruction', 'todo'] as const
export type DocumentType = typeof DOCUMENT_TYPES[number]
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = { requirement: '需求', defect: '缺陷', instruction: '说明', todo: '待办' }

/**
 * 全部状态代码。前 8 个为启用状态，顺序即展示顺序；其余为 REQ-26 之前的旧流程状态，
 * 只为历史属性日志和旧库迁移保留名称，不再出现在筛选、选择和分组中。
 */
export const DOCUMENT_STATES = {
  queued: { name: '待处理', color: '#2f6fed' },
  doing: { name: '进行中', color: '#c15d2b' },
  testing: { name: '测试中', color: '#0891b2' },
  done: { name: '已完成', color: '#198754' },
  closed: { name: '已关闭', color: '#667085' },
  draft: { name: '草稿', color: '#8a94a6' },
  published: { name: '已发布', color: '#198754' },
  archived: { name: '已归档', color: '#667085' },
  review: { name: '待评审', color: '#7c3aed' },
  ready: { name: '待开发', color: '#2f6fed' },
  development: { name: '开发中', color: '#c15d2b' },
  acceptance: { name: '待验收', color: '#7c3aed' },
  release: { name: '待上线', color: '#2f6fed' },
  confirmation: { name: '待确认', color: '#7c3aed' },
  repair_ready: { name: '待修复', color: '#2f6fed' },
  repairing: { name: '修复中', color: '#c15d2b' },
  verification: { name: '待验证', color: '#0891b2' },
} as const
export type DocumentState = keyof typeof DOCUMENT_STATES

const TASK_STATES = ['queued', 'doing', 'testing', 'done', 'closed'] as const satisfies readonly DocumentState[]
const INSTRUCTION_STATES = ['draft', 'published', 'archived'] as const satisfies readonly DocumentState[]

/** 每种类型可用的状态；同类型内任意两个状态之间都可以直接切换。 */
export const DOCUMENT_TYPE_STATES: Record<DocumentType, readonly DocumentState[]> = {
  requirement: TASK_STATES, defect: TASK_STATES, todo: TASK_STATES, instruction: INSTRUCTION_STATES,
}
export const INITIAL_DOCUMENT_STATES: Record<DocumentType, DocumentState> = {
  requirement: 'queued', defect: 'queued', todo: 'queued', instruction: 'draft',
}
export const ACTIVE_DOCUMENT_STATES: readonly DocumentState[] = [...TASK_STATES, ...INSTRUCTION_STATES]

/** Agent meta/schema 暴露的流程契约：states 为状态代码，实际 statusId 从 meta.statuses 按 code 查找。 */
export const DOCUMENT_WORKFLOWS = Object.fromEntries(DOCUMENT_TYPES.map(type => [type, {
  initial: INITIAL_DOCUMENT_STATES[type], states: DOCUMENT_TYPE_STATES[type], transitions: 'any' as const,
}])) as Record<DocumentType, { initial: DocumentState; states: readonly DocumentState[]; transitions: 'any' }>

export function documentStates(type: DocumentType): readonly DocumentState[] { return DOCUMENT_TYPE_STATES[type] }
export function initialDocumentState(type: DocumentType): DocumentState { return INITIAL_DOCUMENT_STATES[type] }
export function isActiveDocumentState(code: string) { return (ACTIVE_DOCUMENT_STATES as readonly string[]).includes(code) }
/** 服务端只校验目标状态属于该文档类型，不限制起点。 */
export function belongsToDocumentType(type: DocumentType, code: string) { return (DOCUMENT_TYPE_STATES[type] as readonly string[]).includes(code) }

export function documentAssigneeIds(row: { assigneeIds: string[] }) {
  return row.assigneeIds
}
