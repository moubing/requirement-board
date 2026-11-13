import type { RichTextDocument, RichTextNode } from '../editor/document'
import { containsTaskItems, isListNodeType, listItemType, type ListNodeType } from '../editor/task-list'
import type { AttributionSnapshot } from '../collaboration/attribution'
import type {
  InlineDiffChunk,
  InlineFormatChange,
  NormalizedInlineMark,
  NormalizedInlineToken,
} from './rich-text-diff'

export interface SelectionHistorySegment {
  blockId: string
  blockType: string
  start: number
  end: number
  text: string
  wholeBlock?: boolean
}

export interface SelectionHistoryAnchor {
  text: string
  segments: SelectionHistorySegment[]
  scope: 'selection' | 'block'
}

export interface SelectionHistoryVersion {
  id: string
  label: string
  version: number | null
  document: RichTextDocument
  createdAt?: string | null
  author?: string | null
  attribution?: AttributionSnapshot | null
  attributionSequence?: number | null
  changeNote?: string | null
  draft?: boolean
}

export type SelectionHistorySegmentStatus = 'unchanged' | 'modified' | 'introduced'
export type SelectionHistoryConfidence = 'exact' | 'inferred' | 'lost'

export interface SelectionHistorySegmentDiff {
  id: string
  targetBlockId: string
  targetStart?: number
  targetEnd?: number
  baseStart?: number
  baseEnd?: number
  wholeBlock?: boolean
  baseBlockId: string | null
  blockType: string
  baseNode: RichTextNode | null
  targetNode: RichTextNode
  status: SelectionHistorySegmentStatus
  confidence: SelectionHistoryConfidence
  changed: boolean
  changeCount: number
  baseChunks: InlineDiffChunk[]
  targetChunks: InlineDiffChunk[]
}

export interface SelectionHistoryEntry {
  id: string
  target: SelectionHistoryVersion
  base: SelectionHistoryVersion | null
  status: SelectionHistorySegmentStatus
  changed: boolean
  changeCount: number
  confidence: SelectionHistoryConfidence
  segments: SelectionHistorySegmentDiff[]
}

export interface SelectionHistoryResult {
  entries: SelectionHistoryEntry[]
  changedEntries: SelectionHistoryEntry[]
}

export interface SelectionHistoryBlock {
  id: string
  type: string
  index: number
  text: string
  attrsSignature: string
  tokens: NormalizedInlineToken[]
  node: RichTextNode
}

interface IndexedInlineOperation {
  status: 'equal' | 'deleted' | 'inserted'
  baseIndex: number
  targetIndex: number
  base?: NormalizedInlineToken
  target?: NormalizedInlineToken
}

interface InlineChangeHunk {
  startOperation: number
  endOperation: number
  baseStart: number
  baseEnd: number
  targetStart: number
  targetEnd: number
}

interface SegmentProjection {
  diff: SelectionHistorySegmentDiff
  baseSegment: SelectionHistorySegment | null
}

const BLOCK_CHILD_CONTAINERS = new Set([
  'blockquote',
  'details',
  'detailsContent',
  'bulletList',
  'doc',
  'listItem',
  'taskList',
  'taskItem',
  'orderedList',
  'tableCell',
  'tableHeader',
  'tableRow',
])

export function extractSelectionHistoryBlocks(document: RichTextDocument): SelectionHistoryBlock[] {
  const blocks: SelectionHistoryBlock[] = []

  function visit(node: RichTextNode, topLevelIndex: string) {
    if (node.type === 'details' || node.type === 'detailsContent') {
      node.content?.forEach((child, index) => visit(child, `${topLevelIndex}_${index}`))
      return
    }
    if (isListNodeType(node.type)) {
      const listItems = node.content?.filter((child) => child.type === listItemType(node.type as ListNodeType)) ?? []
      for (const [itemIndex, listItem] of listItems.entries()) {
        blocks.push(
          createSelectionBlock(
            listItem,
            `${topLevelIndex}_${itemIndex}`,
            blocks.length,
            { listKind: node.type },
          ),
        )
      }
      return
    }

    blocks.push(createSelectionBlock(node, `${topLevelIndex}`, blocks.length))
  }

  document.content.forEach((node, index) => visit(node, String(index)))

  return blocks
}

export function buildSelectionHistory(
  anchor: SelectionHistoryAnchor,
  versions: readonly SelectionHistoryVersion[],
): SelectionHistoryResult {
  const entries: SelectionHistoryEntry[] = []
  let projectedSegments = anchor.segments.map((segment) => ({ ...segment }))

  for (let versionIndex = 0; versionIndex < versions.length && projectedSegments.length; versionIndex += 1) {
    const target = versions[versionIndex]!
    const base = versions[versionIndex + 1] ?? null
    const targetBlocks = extractSelectionHistoryBlocks(target.document)
    const baseBlocks = base ? extractSelectionHistoryBlocks(base.document) : []
    const targetBlocksById = new Map(targetBlocks.map((block) => [block.id, block]))
    const projections: SegmentProjection[] = []

    for (const [segmentIndex, segment] of projectedSegments.entries()) {
      const targetBlock = targetBlocksById.get(segment.blockId)
      if (!targetBlock) continue
      projections.push(
        projectSegment(
          segment,
          segmentIndex,
          targetBlock,
          baseBlocks,
          base === null,
        ),
      )
    }

    if (!projections.length) break

    const segmentDiffs = projections.map((projection) => projection.diff)
    const changed = segmentDiffs.some((segment) => segment.changed)
    const entry: SelectionHistoryEntry = {
      id: target.id,
      target,
      base,
      status: resolveEntryStatus(segmentDiffs, base),
      changed,
      changeCount: segmentDiffs.reduce((count, segment) => count + segment.changeCount, 0),
      confidence: resolveEntryConfidence(segmentDiffs),
      segments: segmentDiffs,
    }
    entries.push(entry)

    if (!base) break
    projectedSegments = mergeProjectedSegments(
      projections.flatMap((projection) => (projection.baseSegment ? [projection.baseSegment] : [])),
    )
  }

  return {
    entries,
    changedEntries: entries.filter((entry) => entry.changed),
  }
}

function createSelectionBlock(
  node: RichTextNode,
  fallbackId: string,
  index: number,
  extraAttrs: Record<string, unknown> = {},
): SelectionHistoryBlock {
  const tokens = inlineTokens(node)
  const attrs = { ...(node.attrs ?? {}), ...extraAttrs }
  delete attrs.diffId
  if (node.type === 'codeBlock' && attrs.title == null) delete attrs.title
  // 勾选按实际选中的任务文字核对，不能把父任务的状态算到子任务选区。
  if (node.type === 'taskItem') delete attrs.checked
  return {
    id: nodeDiffId(node, fallbackId),
    type: node.type,
    index,
    text: tokens.map((token) => token.value).join(''),
    attrsSignature: stableStringify(attrs),
    tokens,
    node,
  }
}

function nodeDiffId(node: RichTextNode, fallbackId: string) {
  const diffId = typeof node.attrs?.diffId === 'string' ? node.attrs.diffId : ''
  return diffId || `${node.type}_${fallbackId}`
}

function inlineTokens(node: RichTextNode): NormalizedInlineToken[] {
  if (node.type === 'hardBreak') return textTokens('\n', [], 'hardBreak')

  if (node.type === 'image') {
    const caption = node.content?.find((child) => child.type === 'imageCaption')
    const captionTokens = caption ? inlineTokens(caption) : []
    if (captionTokens.length) return captionTokens
    const fallbackText = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '图片'
    return textTokens(fallbackText, [])
  }

  if (typeof node.text === 'string') {
    return textTokens(node.text, normalizeMarks(node.marks))
  }

  const result: NormalizedInlineToken[] = []
  const children = node.content ?? []
  const separateChildren = BLOCK_CHILD_CONTAINERS.has(node.type)
  for (const [index, child] of children.entries()) {
    if (separateChildren && index > 0) result.push(...textTokens('\n', []))
    result.push(...inlineTokens(child))
  }
  return result
}

function normalizeMarks(marks: RichTextNode['marks'] = []): NormalizedInlineMark[] {
  return marks
    .map((mark) => {
      let entries = Object.entries(mark.attrs ?? {}).filter(([, value]) => value !== null && value !== undefined)
      if (mark.type === 'link') {
        entries = entries.filter(([key]) => key === 'href' || key === 'target')
      } else if (mark.type === 'highlight') {
        entries = entries.filter(([key]) => key === 'color')
      }
      const attrs = Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
      return Object.keys(attrs).length ? { type: mark.type, attrs } : { type: mark.type }
    })
    .sort((left, right) => markSignature(left).localeCompare(markSignature(right)))
}

function textTokens(
  text: string,
  marks: NormalizedInlineMark[],
  kind?: NormalizedInlineToken['kind'],
): NormalizedInlineToken[] {
  const marksSignature = marks.map(markSignature).join('|')
  return Array.from(text).map((value) => ({
    value,
    marks,
    marksSignature,
    ...(kind ? { kind } : {}),
  }))
}

function markSignature(mark: NormalizedInlineMark) {
  return `${mark.type}:${stableStringify(mark.attrs ?? {})}`
}

function projectSegment(
  segment: SelectionHistorySegment,
  segmentIndex: number,
  targetBlock: SelectionHistoryBlock,
  baseBlocks: SelectionHistoryBlock[],
  initialVersion: boolean,
): SegmentProjection {
  const targetStart = clamp(segment.start, 0, targetBlock.tokens.length)
  const targetEnd = clamp(segment.end, targetStart, targetBlock.tokens.length)
  const normalizedSegment: SelectionHistorySegment = {
    ...segment,
    blockId: targetBlock.id,
    blockType: targetBlock.type,
    start: targetStart,
    end: targetEnd,
    text: tokenText(targetBlock.tokens.slice(targetStart, targetEnd)),
  }

  if (initialVersion) {
    return {
      diff: {
        id: `${targetBlock.id}_${segmentIndex}`,
        targetBlockId: targetBlock.id,
        targetStart, targetEnd, wholeBlock: segment.wholeBlock,
        baseBlockId: null,
        blockType: targetBlock.type,
        baseNode: null,
        targetNode: targetBlock.node,
        status: 'introduced',
        confidence: 'exact',
        changed: true,
        changeCount: 1,
        baseChunks: [],
        targetChunks: tokensToChunks(targetBlock.tokens.slice(targetStart, targetEnd), 'inserted'),
      },
      baseSegment: null,
    }
  }

  const exactBaseBlock = baseBlocks.find((block) => block.id === targetBlock.id) ?? null
  const inferredBaseBlock = exactBaseBlock ? null : inferBaseBlock(baseBlocks, targetBlock, normalizedSegment)
  const baseBlock = exactBaseBlock ?? inferredBaseBlock
  const confidence: SelectionHistoryConfidence = exactBaseBlock ? 'exact' : baseBlock ? 'inferred' : 'lost'

  if (!baseBlock) {
    return {
      diff: {
        id: `${targetBlock.id}_${segmentIndex}`,
        targetBlockId: targetBlock.id,
        targetStart, targetEnd, wholeBlock: segment.wholeBlock,
        baseBlockId: null,
        blockType: targetBlock.type,
        baseNode: null,
        targetNode: targetBlock.node,
        status: 'introduced',
        confidence,
        changed: true,
        changeCount: 1,
        baseChunks: [],
        targetChunks: tokensToChunks(targetBlock.tokens.slice(targetStart, targetEnd), 'inserted'),
      },
      baseSegment: null,
    }
  }

  const operations = diffTokens(baseBlock.tokens, targetBlock.tokens)
  const hunks = buildChangeHunks(operations)
  const intersectingHunks = hunks.filter((hunk) => hunkIntersectsSegment(hunk, normalizedSegment))
  const includedHunks = new Set(intersectingHunks.flatMap((hunk) => operationRange(hunk)))
  const baseChunks: InlineDiffChunk[] = []
  const targetChunks: InlineDiffChunk[] = []
  let formatChangeCount = 0

  for (const [operationIndex, operation] of operations.entries()) {
    if (operation.status === 'equal') {
      if (operation.targetIndex < targetStart || operation.targetIndex >= targetEnd) continue
      const formatChange = createFormatChange(operation.base!, operation.target!)
      if (formatChange) formatChangeCount += 1
      pushChunk(baseChunks, tokenChunk(operation.base!, 'equal', formatChange))
      pushChunk(targetChunks, tokenChunk(operation.target!, 'equal', formatChange))
      continue
    }

    if (!includedHunks.has(operationIndex)) continue
    if (operation.status === 'deleted') {
      pushChunk(baseChunks, tokenChunk(operation.base!, 'deleted'))
    } else {
      pushChunk(targetChunks, tokenChunk(operation.target!, 'inserted'))
    }
  }

  const baseRange = projectRangeToBase(normalizedSegment, operations, intersectingHunks, baseBlock.tokens.length)
  const blockStructureChanged =
    confidence === 'inferred' ||
    baseBlock.type !== targetBlock.type ||
    baseBlock.attrsSignature !== targetBlock.attrsSignature ||
    taskStateSignature(baseBlock.node, baseRange.start, baseRange.end, segment.wholeBlock) !==
      taskStateSignature(targetBlock.node, targetStart, targetEnd, segment.wholeBlock)
  const changed = blockStructureChanged || intersectingHunks.length > 0 || formatChangeCount > 0
  const baseSegment = createBaseSegment(normalizedSegment, baseBlock, baseRange)

  return {
    diff: {
      id: `${targetBlock.id}_${segmentIndex}`,
      targetBlockId: targetBlock.id,
      targetStart, targetEnd, baseStart: baseRange.start, baseEnd: baseRange.end, wholeBlock: segment.wholeBlock,
      baseBlockId: baseBlock.id,
      blockType: targetBlock.type,
      baseNode: baseBlock.node,
      targetNode: targetBlock.node,
      status: changed ? 'modified' : 'unchanged',
      confidence,
      changed,
      changeCount: changed
        ? Math.max(1, intersectingHunks.length + formatChangeCount + (blockStructureChanged ? 1 : 0))
        : 0,
      baseChunks,
      targetChunks,
    },
    baseSegment,
  }
}

// 只跟踪选中文字对应的任务状态；选区外的嵌套条目勾选不冒充文字修改。
export function selectedTaskItems(node: RichTextNode | null, start: number, end: number, wholeBlock = false): RichTextNode[] {
  if (!node || !containsTaskItems(node)) return []
  const tasks = new Set<RichTextNode>()
  function visit(current: RichTextNode, offset: number, owner?: RichTextNode) {
    const task = current.type === 'taskItem' ? current : owner
    if (wholeBlock && current.type === 'taskItem') tasks.add(current)
    if (task && (current.type === 'text' || current.type === 'hardBreak' || current.type === 'image')) {
      if (offset < end && offset + inlineTokens(current).length > start) tasks.add(task)
      return
    }
    let cursor = offset
    for (const [index, child] of (current.content ?? []).entries()) {
      if (index && BLOCK_CHILD_CONTAINERS.has(current.type)) cursor++
      visit(child, cursor, task)
      cursor += inlineTokens(child).length
    }
  }
  visit(node, 0)
  return [...tasks]
}

function taskStateSignature(node: RichTextNode, start: number, end: number, wholeBlock = false) {
  return JSON.stringify(selectedTaskItems(node, start, end, wholeBlock).map(task => task.attrs?.checked === true))
}

function inferBaseBlock(
  baseBlocks: SelectionHistoryBlock[],
  targetBlock: SelectionHistoryBlock,
  segment: SelectionHistorySegment,
) {
  const selectedText = segment.text
  if (!selectedText) return null
  const compatibleBlocks = baseBlocks.filter((block) => block.type === targetBlock.type)
  const exactMatches = compatibleBlocks.filter((block) => countOccurrences(block.text, selectedText) === 1)
  if (exactMatches.length === 1) return exactMatches[0]!

  const containingTarget = compatibleBlocks.filter(
    (block) => targetBlock.text.length >= 4 && block.text.includes(targetBlock.text),
  )
  return containingTarget.length === 1 ? containingTarget[0]! : null
}

function countOccurrences(text: string, fragment: string) {
  if (!fragment) return 0
  let count = 0
  let cursor = 0
  while (cursor <= text.length - fragment.length) {
    const index = text.indexOf(fragment, cursor)
    if (index < 0) break
    count += 1
    cursor = index + Math.max(1, fragment.length)
  }
  return count
}

function diffTokens(baseTokens: NormalizedInlineToken[], targetTokens: NormalizedInlineToken[]) {
  if (baseTokens.length * targetTokens.length > 50000) {
    return diffTokensByPrefixSuffix(baseTokens, targetTokens)
  }

  const table = Array.from({ length: baseTokens.length + 1 }, () =>
    Array<number>(targetTokens.length + 1).fill(0),
  )
  for (let baseIndex = baseTokens.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let targetIndex = targetTokens.length - 1; targetIndex >= 0; targetIndex -= 1) {
      table[baseIndex]![targetIndex] =
        baseTokens[baseIndex]!.value === targetTokens[targetIndex]!.value
          ? table[baseIndex + 1]![targetIndex + 1]! + 1
          : Math.max(table[baseIndex + 1]![targetIndex]!, table[baseIndex]![targetIndex + 1]!)
    }
  }

  const operations: IndexedInlineOperation[] = []
  let baseIndex = 0
  let targetIndex = 0
  while (baseIndex < baseTokens.length && targetIndex < targetTokens.length) {
    if (baseTokens[baseIndex]!.value === targetTokens[targetIndex]!.value) {
      operations.push({
        status: 'equal',
        baseIndex,
        targetIndex,
        base: baseTokens[baseIndex]!,
        target: targetTokens[targetIndex]!,
      })
      baseIndex += 1
      targetIndex += 1
    } else if (table[baseIndex + 1]![targetIndex]! >= table[baseIndex]![targetIndex + 1]!) {
      operations.push({ status: 'deleted', baseIndex, targetIndex, base: baseTokens[baseIndex]! })
      baseIndex += 1
    } else {
      operations.push({ status: 'inserted', baseIndex, targetIndex, target: targetTokens[targetIndex]! })
      targetIndex += 1
    }
  }
  while (baseIndex < baseTokens.length) {
    operations.push({ status: 'deleted', baseIndex, targetIndex, base: baseTokens[baseIndex]! })
    baseIndex += 1
  }
  while (targetIndex < targetTokens.length) {
    operations.push({ status: 'inserted', baseIndex, targetIndex, target: targetTokens[targetIndex]! })
    targetIndex += 1
  }
  return operations
}

function diffTokensByPrefixSuffix(
  baseTokens: NormalizedInlineToken[],
  targetTokens: NormalizedInlineToken[],
) {
  let prefix = 0
  while (
    prefix < baseTokens.length &&
    prefix < targetTokens.length &&
    baseTokens[prefix]!.value === targetTokens[prefix]!.value
  ) {
    prefix += 1
  }
  let baseSuffix = baseTokens.length - 1
  let targetSuffix = targetTokens.length - 1
  while (
    baseSuffix >= prefix &&
    targetSuffix >= prefix &&
    baseTokens[baseSuffix]!.value === targetTokens[targetSuffix]!.value
  ) {
    baseSuffix -= 1
    targetSuffix -= 1
  }

  const operations: IndexedInlineOperation[] = []
  for (let index = 0; index < prefix; index += 1) {
    operations.push({
      status: 'equal',
      baseIndex: index,
      targetIndex: index,
      base: baseTokens[index]!,
      target: targetTokens[index]!,
    })
  }
  for (let index = prefix; index <= baseSuffix; index += 1) {
    operations.push({ status: 'deleted', baseIndex: index, targetIndex: prefix, base: baseTokens[index]! })
  }
  for (let index = prefix; index <= targetSuffix; index += 1) {
    operations.push({ status: 'inserted', baseIndex: baseSuffix + 1, targetIndex: index, target: targetTokens[index]! })
  }
  let baseIndex = baseSuffix + 1
  let targetIndex = targetSuffix + 1
  while (baseIndex < baseTokens.length && targetIndex < targetTokens.length) {
    operations.push({
      status: 'equal',
      baseIndex,
      targetIndex,
      base: baseTokens[baseIndex]!,
      target: targetTokens[targetIndex]!,
    })
    baseIndex += 1
    targetIndex += 1
  }
  return operations
}

function buildChangeHunks(operations: IndexedInlineOperation[]) {
  const hunks: InlineChangeHunk[] = []
  for (let index = 0; index < operations.length; index += 1) {
    if (operations[index]!.status === 'equal') continue
    const startOperation = index
    let baseStart = operations[index]!.baseIndex
    let baseEnd = baseStart
    let targetStart = operations[index]!.targetIndex
    let targetEnd = targetStart
    while (index < operations.length && operations[index]!.status !== 'equal') {
      const operation = operations[index]!
      if (operation.status === 'deleted') baseEnd = Math.max(baseEnd, operation.baseIndex + 1)
      if (operation.status === 'inserted') targetEnd = Math.max(targetEnd, operation.targetIndex + 1)
      index += 1
    }
    hunks.push({
      startOperation,
      endOperation: index,
      baseStart,
      baseEnd,
      targetStart,
      targetEnd,
    })
    index -= 1
  }
  return hunks
}

function hunkIntersectsSegment(hunk: InlineChangeHunk, segment: SelectionHistorySegment) {
  if (hunk.targetStart !== hunk.targetEnd) {
    return hunk.targetStart < segment.end && hunk.targetEnd > segment.start
  }
  const inclusiveBoundary = Boolean(segment.wholeBlock)
  return inclusiveBoundary
    ? hunk.targetStart >= segment.start && hunk.targetStart <= segment.end
    : hunk.targetStart > segment.start && hunk.targetStart < segment.end
}

function operationRange(hunk: InlineChangeHunk) {
  return Array.from(
    { length: hunk.endOperation - hunk.startOperation },
    (_, offset) => hunk.startOperation + offset,
  )
}

function projectRangeToBase(
  segment: SelectionHistorySegment,
  operations: IndexedInlineOperation[],
  hunks: InlineChangeHunk[],
  baseLength: number,
) {
  const targetLength = operations.reduce(
    (length, operation) => Math.max(length, operation.targetIndex + (operation.status === 'deleted' ? 0 : 1)),
    0,
  )
  const boundaryMap = Array<number>(targetLength + 1).fill(0)
  let baseCursor = 0
  let targetCursor = 0
  boundaryMap[0] = 0
  for (const operation of operations) {
    if (operation.status === 'deleted') {
      baseCursor += 1
      boundaryMap[targetCursor] = baseCursor
    } else if (operation.status === 'inserted') {
      targetCursor += 1
      boundaryMap[targetCursor] = baseCursor
    } else {
      baseCursor += 1
      targetCursor += 1
      boundaryMap[targetCursor] = baseCursor
    }
  }

  let start = boundaryMap[clamp(segment.start, 0, targetLength)] ?? 0
  let end = boundaryMap[clamp(segment.end, 0, targetLength)] ?? start
  for (const hunk of hunks) {
    start = Math.min(start, hunk.baseStart)
    end = Math.max(end, hunk.baseEnd)
  }
  return {
    start: clamp(start, 0, baseLength),
    end: clamp(Math.max(start, end), 0, baseLength),
  }
}

function createBaseSegment(
  targetSegment: SelectionHistorySegment,
  baseBlock: SelectionHistoryBlock,
  range: { start: number; end: number },
) {
  if (!targetSegment.wholeBlock && range.start === range.end && targetSegment.start !== targetSegment.end) {
    return null
  }
  return {
    blockId: baseBlock.id,
    blockType: baseBlock.type,
    start: range.start,
    end: range.end,
    text: tokenText(baseBlock.tokens.slice(range.start, range.end)),
    wholeBlock: Boolean(targetSegment.wholeBlock && range.start === 0 && range.end === baseBlock.tokens.length),
  }
}

function mergeProjectedSegments(segments: SelectionHistorySegment[]) {
  const byBlock = new Map<string, SelectionHistorySegment[]>()
  for (const segment of segments) {
    const values = byBlock.get(segment.blockId) ?? []
    values.push(segment)
    byBlock.set(segment.blockId, values)
  }

  const merged: SelectionHistorySegment[] = []
  for (const values of byBlock.values()) {
    values.sort((left, right) => left.start - right.start)
    for (const segment of values) {
      const previous = merged[merged.length - 1]
      if (previous?.blockId === segment.blockId && segment.start <= previous.end) {
        previous.end = Math.max(previous.end, segment.end)
        previous.text += segment.text
        previous.wholeBlock = previous.wholeBlock || segment.wholeBlock
      } else {
        merged.push({ ...segment })
      }
    }
  }
  return merged
}

function createFormatChange(base: NormalizedInlineToken, target: NormalizedInlineToken) {
  if (base.marksSignature === target.marksSignature) return undefined
  return {
    before: base.marks,
    after: target.marks,
  } satisfies InlineFormatChange
}

function tokensToChunks(tokens: NormalizedInlineToken[], status: InlineDiffChunk['status']) {
  const chunks: InlineDiffChunk[] = []
  for (const token of tokens) pushChunk(chunks, tokenChunk(token, status))
  return chunks
}

function tokenChunk(
  token: NormalizedInlineToken,
  status: InlineDiffChunk['status'],
  formatChange?: InlineFormatChange,
): InlineDiffChunk {
  return {
    status,
    value: token.value,
    ...(token.marks.length ? { marks: token.marks } : {}),
    ...(formatChange ? { formatChange } : {}),
  }
}

function pushChunk(chunks: InlineDiffChunk[], next: InlineDiffChunk) {
  if (!next.value) return
  const previous = chunks[chunks.length - 1]
  if (
    previous &&
    previous.status === next.status &&
    stableStringify(previous.marks ?? []) === stableStringify(next.marks ?? []) &&
    stableStringify(previous.formatChange ?? null) === stableStringify(next.formatChange ?? null)
  ) {
    previous.value += next.value
    return
  }
  chunks.push({ ...next })
}

function resolveEntryStatus(segments: SelectionHistorySegmentDiff[], base: SelectionHistoryVersion | null) {
  if (!base || segments.every((segment) => segment.status === 'introduced')) return 'introduced'
  return segments.some((segment) => segment.changed) ? 'modified' : 'unchanged'
}

function resolveEntryConfidence(segments: SelectionHistorySegmentDiff[]) {
  if (segments.some((segment) => segment.confidence === 'lost')) return 'lost'
  if (segments.some((segment) => segment.confidence === 'inferred')) return 'inferred'
  return 'exact'
}

function tokenText(tokens: NormalizedInlineToken[]) {
  return tokens.map((token) => token.value).join('')
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}
