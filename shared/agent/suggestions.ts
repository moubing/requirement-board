import { z } from 'zod'
import { cloneRichTextDocument, createDiffId, isBlockNode, type RichTextDocument, type RichTextNode } from '../editor/document'
import { nodeJsonSchema, richTextDocumentSchema, richTextProseMirrorSchema } from '../editor/validation'
import { draftDocumentSchema } from '../drafts/validation'
import type { AgentLockDto } from './lock'
import { requirementPropertyPatchSchema, type RequirementPropertyPatch } from '../requirements/properties'
import { DOCUMENT_TYPES } from '../documents/workflow'
import { annotationCompletionsSchema } from './annotation-completion'
import { normalizeTrailingParagraph } from '../editor/trailing-paragraph'

export const DOCUMENT_SCHEMA_VERSION = 3
export const MAX_AGENT_DOCUMENT_BYTES = 4 * 1024 * 1024

const blockId = z.string().min(1).max(100)
export const suggestionOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_title'), title: z.string().trim().min(1).max(240) }).strict(),
  z.object({ op: z.literal('replace_block'), targetDiffId: blockId, node: nodeJsonSchema }).strict(),
  z.object({ op: z.literal('insert_blocks'), anchorDiffId: blockId, position: z.enum(['before', 'after']), nodes: z.array(nodeJsonSchema).min(1).max(100) }).strict(),
  z.object({ op: z.literal('delete_block'), targetDiffId: blockId }).strict(),
])
export type SuggestionOperation = z.infer<typeof suggestionOperationSchema>
export const suggestionInputSchema = z.object({
  snapshotId: z.string().regex(/^snap_[a-zA-Z0-9_-]{16,64}$/),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/),
  changeNote: z.string().trim().min(1).max(500),
  operations: z.array(suggestionOperationSchema).max(100),
  properties: requirementPropertyPatchSchema.optional(),
  saveRevision: z.object({ changeNote: z.string().trim().min(1).max(500) }).strict().optional(),
  completedAnnotations: annotationCompletionsSchema.optional(),
}).strict()
export type SuggestionInput = z.infer<typeof suggestionInputSchema>
export const createSuggestionInputSchema = z.object({
  action: z.literal('create'),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/),
  changeNote: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(240),
  contentJson: richTextDocumentSchema,
  properties: requirementPropertyPatchSchema.optional(),
}).strict()
export const agentRequestSchema = z.union([suggestionInputSchema, createSuggestionInputSchema])
export type CreateSuggestionInput = z.infer<typeof createSuggestionInputSchema>
export type DocumentSnapshot = { title: string; contentJson: RichTextDocument }
export type SuggestionStatus = 'pending' | 'applied' | 'rejected'
export type SuggestionConflictReason = 'document_changed' | 'schema_changed' | 'properties_changed' | 'revision_changed' | null

export class SuggestionContentError extends Error {
  constructor(message: string, public operationIndex: number | null = null) { super(message) }
}

function collectIds(node: RichTextNode, ids = new Set<string>()) {
  if (isBlockNode(node) && typeof node.attrs?.diffId === 'string') ids.add(node.attrs.diffId)
  node.content?.forEach(child => collectIds(child, ids))
  return ids
}

function assertCellIdentities(original: RichTextNode, next: RichTextNode) {
  const cells = new Map<string, RichTextNode>()
  const visit = (node: RichTextNode, check: boolean) => {
    const id = node.attrs?.diffId
    if (['tableCell', 'tableHeader'].includes(node.type) && typeof id === 'string') {
      if (!check) cells.set(id, node)
      else {
        const previous = cells.get(id)
        if (previous && (previous.type !== node.type || (previous.attrs?.rowspan ?? 1) !== (node.attrs?.rowspan ?? 1)
          || (previous.attrs?.colspan ?? 1) !== (node.attrs?.colspan ?? 1))) throw new SuggestionContentError('合并、拆分、转换类型或改变跨度的单元格须省略 diffId，分配新身份')
      }
    }
    node.content?.forEach(child => visit(child, check))
  }
  visit(original, false); visit(next, true)
}

/** Existing IDs belong to their original top-level block; only genuinely new nodes get IDs. */
function assignNewIds(node: RichTextNode, allowed: Set<string>, seen: Set<string>, makeId: () => string) {
  if (isBlockNode(node)) {
    const id = node.attrs?.diffId
    if (id === undefined) {
      node.attrs = { ...node.attrs, diffId: makeId() }
    } else {
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) throw new SuggestionContentError('块 ID 重复、无效，或不属于被替换的块；新增节点请省略 diffId')
      seen.add(id)
    }
  }
  node.content?.forEach(child => assignNewIds(child, allowed, seen, makeId))
}

export function applySuggestionOperations(base: DocumentSnapshot, operations: SuggestionOperation[], makeId = () => createDiffId()) {
  const contentJson = cloneRichTextDocument(base.contentJson)
  let title = base.title
  const originals = new Map<string, RichTextNode>()
  for (const node of base.contentJson.content) {
    const id = node.attrs?.diffId
    if (typeof id !== 'string' || !id || originals.has(id)) throw new SuggestionContentError('读取快照的顶层块 ID 缺失或重复')
    originals.set(id, node)
  }
  const targets = new Set<string>()
  const anchors = new Set<string>()
  const deleted = new Set(operations.filter(op => op.op === 'delete_block').map(op => op.targetDiffId))
  let titleChanged = false
  for (const [index, operation] of operations.entries()) {
    try {
      if (operation.op === 'set_title') {
        if (titleChanged) throw new SuggestionContentError('一次建议只能修改一次标题')
        titleChanged = true
        title = operation.title
        continue
      }
      const id = operation.op === 'insert_blocks' ? operation.anchorDiffId : operation.targetDiffId
      const original = originals.get(id)
      const position = contentJson.content.findIndex(node => node.attrs?.diffId === id)
      if (!original || position < 0) throw new SuggestionContentError('目标必须是读取快照中存在的顶层块')
      if (operation.op === 'insert_blocks') {
        if (anchors.has(id) || deleted.has(id)) throw new SuggestionContentError('同一锚点的插入请合为一条操作，且不能删除该锚点')
        anchors.add(id)
        const nodes = structuredClone(operation.nodes)
        nodes.forEach(node => assignNewIds(node, new Set(), new Set(), makeId))
        contentJson.content.splice(position + (operation.position === 'after' ? 1 : 0), 0, ...nodes)
      } else {
        if (targets.has(id)) throw new SuggestionContentError('同一块不能重复替换或删除')
        targets.add(id)
        if (operation.op === 'delete_block') contentJson.content.splice(position, 1)
        else {
          const node = structuredClone(operation.node)
          if (node.attrs?.diffId !== id) throw new SuggestionContentError('替换块必须保留目标 diffId')
          assertCellIdentities(original, node)
          assignNewIds(node, collectIds(original), new Set(), makeId)
          contentJson.content[position] = node
        }
      }
    } catch (error) {
      if (error instanceof SuggestionContentError) throw new SuggestionContentError(error.message, index)
      throw error
    }
  }
  const checked = draftDocumentSchema.safeParse(contentJson)
  if (!checked.success) throw new SuggestionContentError(checked.error.issues.map(issue => issue.message).join('；'))
  // Use the same schema defaults as collaboration export, before previewing or freezing a suggestion.
  const normalized = normalizeTrailingParagraph(richTextProseMirrorSchema.nodeFromJSON(checked.data).toJSON() as RichTextDocument)
  const candidate = { title, contentJson: normalized }
  if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_AGENT_DOCUMENT_BYTES) throw new SuggestionContentError('候选正文不能超过 4 MiB')
  return candidate
}

export interface AgentSnapshotDto extends DocumentSnapshot {
  id: string
  requirementId: string
  schemaVersion: number
  createdAt: string
  expiresAt: string
  lock: AgentLockDto
  properties?: RequirementPropertyPatch
  baseRevisionId?: string | null
}
