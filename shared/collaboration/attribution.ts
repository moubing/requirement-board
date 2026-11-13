import type { CollaborationSnapshot } from './document'
import type { RichTextDocument, RichTextNode } from '../editor/document'

export interface NodeContributor { userId: string; name: string }
export interface NodeAttribution {
  id: string
  type: string
  authors: NodeContributor[]
  unknown: boolean
}

/** 仅表示基准版本之后参与修改的人员，不表示节点的原始作者。 */
export interface AttributionSnapshot {
  version: 2
  baseRevisionId: string | null
  baseVersion: number
  nodes: NodeAttribution[]
}

/** 已落盘的逐字来源只读保留，由服务端按版本区间转换后返回。 */
export interface LegacyAttributionSnapshot { version: 1; blocks: unknown[] }
export type StoredAttributionSnapshot = AttributionSnapshot | LegacyAttributionSnapshot
export interface CollaborationEdit {
  id: string
  clientId: number
  update: string
  intent: 'edit' | 'restore' | 'legacy'
}
export interface AttributionState { sequence: number; snapshot: AttributionSnapshot }
export interface AttributionReceipt {
  authorId: string | null
  authorName: string
  intent: CollaborationEdit['intent']
  blockIds: string[]
}
export interface AttributionNode { id: string; type: string; node: RichTextNode; parentId: string | null; depth: number }

export function isAttributionSnapshot(value: unknown): value is AttributionSnapshot {
  const record = (entry: unknown): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry)
  return record(value) && value.version === 2 && (value.baseRevisionId === null || typeof value.baseRevisionId === 'string')
    && Number.isSafeInteger(value.baseVersion) && Number(value.baseVersion) >= 0 && Array.isArray(value.nodes)
    && value.nodes.every(node => record(node) && typeof node.id === 'string' && typeof node.type === 'string'
      && typeof node.unknown === 'boolean' && Array.isArray(node.authors)
      && node.authors.every(author => record(author) && typeof author.userId === 'string' && typeof author.name === 'string'))
}

export function emptyAttribution(base?: { id: string; version: number } | null): AttributionSnapshot {
  return { version: 2, baseRevisionId: base?.id ?? null, baseVersion: base?.version ?? 0, nodes: [] }
}

/** 复用正文的稳定 diffId；表格单元格中的段落也可独立记录。 */
export function attributionNodes(document: RichTextDocument): AttributionNode[] {
  const nodes: AttributionNode[] = []
  function visit(node: RichTextNode, parentId: string | null, depth: number) {
    const id = typeof node.attrs?.diffId === 'string' && node.attrs.diffId ? node.attrs.diffId : null
    if (id) nodes.push({ id, type: node.type, node, parentId, depth })
    for (const child of node.content ?? []) visit(child, id ?? parentId, id ? depth + 1 : depth)
  }
  visit(document, null, 0)
  return nodes
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)

/** 只比较节点，不读取 Yjs 字符身份；插入节点不会把其后的所有节点算作修改。 */
export function changedAttributionNodes(before: CollaborationSnapshot, after: CollaborationSnapshot): { id: string; type: string }[] {
  const left = new Map(attributionNodes(before.contentJson).map(node => [node.id, node]))
  const right = new Map(attributionNodes(after.contentJson).map(node => [node.id, node]))
  const common = new Set([...left.keys()].filter(id => right.has(id)))
  function positions(nodes: Map<string, AttributionNode>) {
    const counters = new Map<string | null, number>()
    return new Map([...nodes.values()].filter(node => common.has(node.id)).map(node => {
      const index = counters.get(node.parentId) ?? 0
      counters.set(node.parentId, index + 1)
      return [node.id, index]
    }))
  }
  const leftPositions = positions(left), rightPositions = positions(right)
  const changed: { id: string; type: string }[] = []
  if (before.title !== after.title) changed.push({ id: '$title', type: 'title' })
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id), b = right.get(id)
    if (!a || !b || a.parentId !== b.parentId || leftPositions.get(id) !== rightPositions.get(id) || stable(a.node) !== stable(b.node)) {
      changed.push({ id, type: (b ?? a)!.type })
    }
  }
  return changed
}

export function addNodeContributors(snapshot: AttributionSnapshot, nodes: { id: string; type: string }[], author: NodeContributor | null): AttributionSnapshot {
  const result = new Map(snapshot.nodes.map(node => [node.id, { ...node, authors: [...node.authors] }]))
  for (const node of nodes) {
    const entry = result.get(node.id) ?? { ...node, authors: [], unknown: false }
    entry.type = node.type
    if (author) {
      const index = entry.authors.findIndex(value => value.userId === author.userId)
      if (index < 0) entry.authors.push(author)
      else entry.authors[index] = author
    } else entry.unknown = true
    result.set(node.id, entry)
  }
  return { ...snapshot, nodes: [...result.values()] }
}

/** 旧记录迁移与重建使用区间内的收据，不从文字来源猜测本版修改人。 */
export function attributionFromReceipts(base: { id: string; version: number; title: string; contentJson: RichTextDocument } | null,
  current: CollaborationSnapshot, receipts: AttributionReceipt[]): AttributionSnapshot {
  const types = new Map([...(base ? attributionNodes(base.contentJson) : []), ...attributionNodes(current.contentJson)].map(node => [node.id, node.type]))
  types.set('$title', 'title')
  let result = emptyAttribution(base)
  for (const receipt of receipts) {
    result = addNodeContributors(result, receipt.blockIds.filter(id => types.has(id)).map(id => ({ id, type: types.get(id)! })),
      receipt.authorId && receipt.intent !== 'legacy' ? { userId: receipt.authorId, name: receipt.authorName } : null)
  }
  const recorded = new Set(result.nodes.map(node => node.id))
  const unrecorded = changedAttributionNodes(base ?? { title: '', contentJson: { type: 'doc', content: [] } }, current)
    .filter(node => !recorded.has(node.id))
  return addNodeContributors(result, unrecorded, null)
}

/** 同一编辑序号也可能跨过保存边界；旧响应不能覆盖新一版的名单。 */
export function newerAttribution(next: AttributionState, previous?: AttributionState): boolean {
  return isAttributionSnapshot(next.snapshot) && (!previous || (next.sequence >= previous.sequence
    && next.snapshot.baseVersion >= previous.snapshot.baseVersion))
}
