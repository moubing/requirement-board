import type { RichTextDocument, RichTextNode } from '../editor/document'
import { normalizeImageAlignment } from '../editor/document'
import { tableColumnWidths } from '../editor/table-columns'
import { isListNodeType, listItemType, type ListNodeType } from '../editor/task-list'

export type DiffStatus = 'unchanged' | 'modified' | 'inserted' | 'deleted'
export type InlineChunkStatus = 'equal' | 'inserted' | 'deleted'

export interface NormalizedInlineMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface InlineFormatChange {
  before: NormalizedInlineMark[]
  after: NormalizedInlineMark[]
}

export interface InlineDiffChunk {
  status: InlineChunkStatus
  value: string
  marks?: NormalizedInlineMark[]
  formatChange?: InlineFormatChange
}

export interface NormalizedInlineToken {
  value: string
  marks: NormalizedInlineMark[]
  marksSignature: string
  kind?: 'hardBreak'
}

export interface NormalizedDiffBlock {
  id: string
  type: string
  attrsSignature: string
  marksSignature: string
  text: string
  inlineTokens: NormalizedInlineToken[]
  node: RichTextNode
  list?: {
    kind: ListNodeType
    number: number
    parentId: string
    attrs?: Record<string, unknown>
  }
}

export interface TableCellDiff {
  status: DiffStatus
  base: RichTextNode | null
  target: RichTextNode | null
  baseChunks: InlineDiffChunk[]
  targetChunks: InlineDiffChunk[]
}

export interface TableRowDiff {
  cells: TableCellDiff[]
}

export interface TableDiff {
  rows: TableRowDiff[]
  changed: boolean
  columnWidthsChanged: boolean
}

export interface DiffBlockPair {
  id: string
  status: DiffStatus
  base: NormalizedDiffBlock | null
  target: NormalizedDiffBlock | null
  baseChunks: InlineDiffChunk[]
  targetChunks: InlineDiffChunk[]
  table?: TableDiff
}

export interface RichTextDiffResult {
  pairs: DiffBlockPair[]
  counts: Record<DiffStatus, number>
}


export function buildRichTextDiff(baseDoc: RichTextDocument, targetDoc: RichTextDocument): RichTextDiffResult {
  const steps = richTextDiffSteps(baseDoc, targetDoc)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

/** 与同步入口共用全部算法；正文后台核对可在块与块之间让出主线程。 */
export function* richTextDiffSteps(baseDoc: RichTextDocument, targetDoc: RichTextDocument): Generator<void, RichTextDiffResult> {
  const baseBlocks: NormalizedDiffBlock[] = [], targetBlocks: NormalizedDiffBlock[] = []
  for (const [document, blocks] of [[baseDoc, baseBlocks], [targetDoc, targetBlocks]] as const) {
    for (const [index, node] of (document.content ?? []).entries()) {
      pushNormalizedBlocks(blocks, node, `${index}`)
      yield
    }
  }
  const pairs = yield* alignBlocks(baseBlocks, targetBlocks)
  const counts: Record<DiffStatus, number> = {
    unchanged: 0,
    modified: 0,
    inserted: 0,
    deleted: 0,
  }

  for (const pair of pairs) {
    counts[pair.status] += 1
  }

  return { pairs, counts }
}

export function normalizeDocument(doc: RichTextDocument): NormalizedDiffBlock[] {
  const blocks: NormalizedDiffBlock[] = []

  for (const [index, node] of (doc.content ?? []).entries()) {
    pushNormalizedBlocks(blocks, node, `${index}`)
  }

  return blocks
}

function pushNormalizedBlocks(blocks: NormalizedDiffBlock[], node: RichTextNode, fallbackId: string) {
  if (isListNodeType(node.type)) {
    const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1
    const listItems = node.content?.filter((child) => child.type === listItemType(node.type as ListNodeType)) ?? []
    const parentId = nodeDiffId(node, fallbackId)

    if (!listItems.length) {
      blocks.push(normalizeBlock(node, fallbackId))
      return
    }

    for (const [index, listItem] of listItems.entries()) {
      blocks.push(
        normalizeBlock(listItem, `${fallbackId}_${index}`, {
          kind: node.type,
          number: node.type === 'orderedList' ? start + index : index + 1,
          parentId,
          attrs: { ...stableAttrs(node), ...(node.type === 'orderedList' ? { start } : {}) },
        }),
      )
    }
    return
  }

  blocks.push(normalizeBlock(node, fallbackId))
}

function* alignBlocks(baseBlocks: NormalizedDiffBlock[], targetBlocks: NormalizedDiffBlock[]): Generator<void, DiffBlockPair[]> {
  const pairs: DiffBlockPair[] = []
  let baseIndex = 0
  let targetIndex = 0

  while (baseIndex < baseBlocks.length || targetIndex < targetBlocks.length) {
    yield
    const base = baseBlocks[baseIndex] ?? null
    const target = targetBlocks[targetIndex] ?? null

    if (!base && target) {
      pairs.push(createPair(null, target))
      targetIndex += 1
      continue
    }

    if (base && !target) {
      pairs.push(createPair(base, null))
      baseIndex += 1
      continue
    }

    if (!base || !target) continue

    if (base.id === target.id) {
      pairs.push(createPair(base, target))
      baseIndex += 1
      targetIndex += 1
      continue
    }

    const targetSeenInBase = findNextIndex(baseBlocks, target.id, baseIndex + 1)
    const baseSeenInTarget = findNextIndex(targetBlocks, base.id, targetIndex + 1)

    if (targetSeenInBase !== -1 && (baseSeenInTarget === -1 || targetSeenInBase - baseIndex <= baseSeenInTarget - targetIndex)) {
      pairs.push(createPair(base, null))
      baseIndex += 1
      continue
    }

    if (baseSeenInTarget !== -1) {
      pairs.push(createPair(null, target))
      targetIndex += 1
      continue
    }

    if (base.type === target.type) {
      pairs.push(createPair(base, target))
      baseIndex += 1
      targetIndex += 1
      continue
    }

    pairs.push(createPair(base, null))
    pairs.push(createPair(null, target))
    baseIndex += 1
    targetIndex += 1
  }

  return pairs
}

function createPair(base: NormalizedDiffBlock | null, target: NormalizedDiffBlock | null): DiffBlockPair {
  if (!base && !target) {
    throw new Error('Cannot create an empty diff pair')
  }

  if (!base && target) {
    return {
      id: target.id,
      status: 'inserted',
      base,
      target,
      baseChunks: [],
      targetChunks: tokensToChunks(target.inlineTokens, 'inserted'),
      table: buildTableDiff(null, target.node),
    }
  }

  if (base && !target) {
    return {
      id: base.id,
      status: 'deleted',
      base,
      target,
      baseChunks: tokensToChunks(base.inlineTokens, 'deleted'),
      targetChunks: [],
      table: buildTableDiff(base.node, null),
    }
  }

  const safeBase = base!
  const safeTarget = target!
  const table = buildTableDiff(safeBase.node, safeTarget.node)
  const unchanged =
    safeBase.type === safeTarget.type &&
    safeBase.attrsSignature === safeTarget.attrsSignature &&
    safeBase.text === safeTarget.text &&
    safeBase.marksSignature === safeTarget.marksSignature &&
    !table?.changed

  if (unchanged) {
    return {
      id: safeTarget.id,
      status: 'unchanged',
      base: safeBase,
      target: safeTarget,
      baseChunks: tokensToChunks(safeBase.inlineTokens, 'equal'),
      targetChunks: tokensToChunks(safeTarget.inlineTokens, 'equal'),
      table,
    }
  }

  const { baseChunks, targetChunks } = diffInlineTokens(safeBase.inlineTokens, safeTarget.inlineTokens)

  return {
    id: safeTarget.id,
    status: 'modified',
    base: safeBase,
    target: safeTarget,
    baseChunks,
    targetChunks,
    table,
  }
}

function buildTableDiff(baseNode: RichTextNode | null, targetNode: RichTextNode | null): TableDiff | undefined {
  const baseTable = baseNode?.type === 'table' ? baseNode : null
  const targetTable = targetNode?.type === 'table' ? targetNode : null
  if (!baseTable && !targetTable) return undefined

  const baseRows = tableRows(baseTable)
  const targetRows = tableRows(targetTable)
  const rows: TableRowDiff[] = []
  let changed = baseRows.length !== targetRows.length

  for (let rowIndex = 0; rowIndex < Math.max(baseRows.length, targetRows.length); rowIndex += 1) {
    const baseCells = tableCells(baseRows[rowIndex])
    const targetCells = tableCells(targetRows[rowIndex])
    const cells: TableCellDiff[] = []
    if (baseCells.length !== targetCells.length) changed = true

    for (let cellIndex = 0; cellIndex < Math.max(baseCells.length, targetCells.length); cellIndex += 1) {
      const cell = createTableCellDiff(baseCells[cellIndex] ?? null, targetCells[cellIndex] ?? null)
      if (cell.status !== 'unchanged') changed = true
      cells.push(cell)
    }

    rows.push({ cells })
  }

  const baseWidths = tableColumnWidths(baseTable), targetWidths = tableColumnWidths(targetTable)
  const columnWidthsChanged = Boolean(baseTable && targetTable && [...baseWidths, ...targetWidths].some(Boolean)
    && stableStringify(baseWidths) !== stableStringify(targetWidths))
  return { rows, changed, columnWidthsChanged }
}

function createTableCellDiff(base: RichTextNode | null, target: RichTextNode | null): TableCellDiff {
  const baseTokens = base ? blockInlineTokens(base) : []
  const targetTokens = target ? blockInlineTokens(target) : []
  const baseText = inlineTokensText(baseTokens)
  const targetText = inlineTokensText(targetTokens)

  if (!base && target) {
    return {
      status: 'inserted',
      base,
      target,
      baseChunks: [],
      targetChunks: tokensToChunks(targetTokens, 'inserted'),
    }
  }

  if (base && !target) {
    return {
      status: 'deleted',
      base,
      target,
      baseChunks: tokensToChunks(baseTokens, 'deleted'),
      targetChunks: [],
    }
  }

  const safeBase = base!
  const safeTarget = target!
  const unchanged =
    safeBase.type === safeTarget.type &&
    stableStringify(stableAttrs(safeBase)) === stableStringify(stableAttrs(safeTarget)) &&
    stableStringify(childStructure(safeBase)) === stableStringify(childStructure(safeTarget)) &&
    baseText === targetText &&
    inlineMarksSignature(baseTokens) === inlineMarksSignature(targetTokens)

  if (unchanged) {
    return {
      status: 'unchanged',
      base: safeBase,
      target: safeTarget,
      baseChunks: tokensToChunks(baseTokens, 'equal'),
      targetChunks: tokensToChunks(targetTokens, 'equal'),
    }
  }

  const { baseChunks, targetChunks } = diffInlineTokens(baseTokens, targetTokens)
  return {
    status: 'modified',
    base: safeBase,
    target: safeTarget,
    baseChunks,
    targetChunks,
  }
}

function tableRows(table: RichTextNode | null) {
  return table?.content?.filter((node) => node.type === 'tableRow') ?? []
}

function tableCells(row: RichTextNode | undefined) {
  return row?.content?.filter((node) => node.type === 'tableHeader' || node.type === 'tableCell') ?? []
}

function normalizeBlock(
  node: RichTextNode,
  fallbackId: string,
  list?: NormalizedDiffBlock['list'],
): NormalizedDiffBlock {
  const attrsForSignature = { ...stableAttrs(node), ...(list ? { listKind: list.kind, listAttrs: list.attrs ?? {} } : {}), structure: childStructure(node) }
  const inlineTokens = blockInlineTokens(node)
  return {
    id: nodeDiffId(node, fallbackId),
    type: node.type,
    attrsSignature: stableStringify(attrsForSignature),
    marksSignature: inlineMarksSignature(inlineTokens),
    text: inlineTokensText(inlineTokens),
    inlineTokens,
    node,
    list,
  }
}

function nodeDiffId(node: RichTextNode, fallbackId: string) {
  const attrs = node.attrs ?? {}
  return typeof attrs.diffId === 'string' && attrs.diffId ? attrs.diffId : `${node.type}_${fallbackId}`
}

function stableAttrs(node: RichTextNode) {
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([, value]) => value != null))
  delete attrs.diffId
  if (node.type === 'image') attrs.align = normalizeImageAlignment(attrs.align)
  if (node.type === 'taskItem') attrs.checked = node.attrs?.checked === true
  return attrs
}

// 文本/marks 由 token 比较；嵌套块的类型、资源和结构也属于正文变化。
function childStructure(node: RichTextNode): unknown[] {
  return (node.content ?? []).filter(child => child.type !== 'text' && child.type !== 'hardBreak')
    .map(child => [child.type, stableAttrs(child), childStructure(child)])
}

function blockInlineTokens(node: RichTextNode): NormalizedInlineToken[] {
  if (node.type === 'hardBreak') {
    return textToInlineTokens('\n', [], 'hardBreak')
  }

  if (node.type === 'image') {
    const caption = node.content?.find((child) => child.type === 'imageCaption')
    const captionTokens = caption ? blockInlineTokens(caption) : []
    if (captionTokens.length) return captionTokens
    const fallbackText = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '图片'
    return textToInlineTokens(fallbackText, [])
  }

  if (typeof node.text === 'string') {
    return textToInlineTokens(node.text, normalizeInlineMarks(node.marks))
  }

  const children = (node.content ?? []).map((child) => blockInlineTokens(child))
  // 提示块和正文一样直接承载 inline*，不同 marks 的文字之间不能插入换行。
  const separator = ['paragraph', 'callout', 'detailsSummary'].includes(node.type) ? [] : textToInlineTokens('\n', [])
  const tokens: NormalizedInlineToken[] = []

  for (const [index, childTokens] of children.entries()) {
    if (index > 0) tokens.push(...separator)
    tokens.push(...childTokens)
  }

  return trimInlineTokens(tokens)
}

function textToInlineTokens(
  text: string,
  marks: NormalizedInlineMark[],
  kind?: NormalizedInlineToken['kind'],
): NormalizedInlineToken[] {
  const marksSignature = normalizedMarksSignature(marks)
  return Array.from(text).map((value) => ({
    value,
    marks,
    marksSignature,
    ...(kind ? { kind } : {}),
  }))
}

function trimInlineTokens(tokens: NormalizedInlineToken[]) {
  let start = 0
  let end = tokens.length
  while (start < end && isTrimmableInlineWhitespace(tokens[start]!)) start += 1
  while (end > start && isTrimmableInlineWhitespace(tokens[end - 1]!)) end -= 1
  return tokens.slice(start, end)
}

function isTrimmableInlineWhitespace(token: NormalizedInlineToken) {
  return token.kind !== 'hardBreak' && /\s/u.test(token.value)
}

function normalizeInlineMarks(marks: RichTextNode['marks'] = []): NormalizedInlineMark[] {
  return marks
    .map((mark) => {
      const attrs = normalizeMarkAttrs(mark.type, mark.attrs)
      return Object.keys(attrs).length ? { type: mark.type, attrs } : { type: mark.type }
    })
    .sort((left, right) => normalizedMarkSignature(left).localeCompare(normalizedMarkSignature(right)))
}

function normalizeMarkAttrs(type: string, attrs: Record<string, unknown> = {}) {
  let entries = Object.entries(attrs).filter(([, value]) => value !== null && value !== undefined)

  if (type === 'link') {
    entries = entries.filter(([key]) => key === 'href' || key === 'target')
  } else if (type === 'highlight') {
    entries = entries.filter(([key]) => key === 'color')
  }

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function normalizedMarkSignature(mark: NormalizedInlineMark) {
  return `${mark.type}:${stableStringify(mark.attrs ?? {})}`
}

function normalizedMarksSignature(marks: NormalizedInlineMark[]) {
  return marks.map((mark) => normalizedMarkSignature(mark)).join('|')
}

function inlineMarksSignature(tokens: NormalizedInlineToken[]) {
  return tokens.map((token) => token.marksSignature).join('\u0001')
}

function inlineTokensText(tokens: NormalizedInlineToken[]) {
  return tokens.map((token) => token.value).join('')
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

function findNextIndex(blocks: NormalizedDiffBlock[], id: string, start: number) {
  for (let index = start; index < blocks.length; index += 1) {
    if (blocks[index]!.id === id) return index
  }
  return -1
}

type InlineDiffOperation =
  | { status: 'equal'; base: NormalizedInlineToken; target: NormalizedInlineToken }
  | { status: 'deleted'; base: NormalizedInlineToken }
  | { status: 'inserted'; target: NormalizedInlineToken }

function diffInlineTokens(baseTokens: NormalizedInlineToken[], targetTokens: NormalizedInlineToken[]) {
  const operations =
    baseTokens.length * targetTokens.length > 50000
      ? diffTokensByPrefixSuffix(baseTokens, targetTokens)
      : diffTokensByLcs(baseTokens, targetTokens)

  const baseChunks: InlineDiffChunk[] = []
  const targetChunks: InlineDiffChunk[] = []

  for (const operation of operations) {
    if (operation.status === 'equal') {
      const formatChange =
        operation.base.marksSignature === operation.target.marksSignature
          ? undefined
          : {
              before: operation.base.marks,
              after: operation.target.marks,
            }
      pushChunk(baseChunks, tokenToChunk(operation.base, 'equal', formatChange))
      pushChunk(targetChunks, tokenToChunk(operation.target, 'equal', formatChange))
    } else if (operation.status === 'deleted') {
      pushChunk(baseChunks, tokenToChunk(operation.base, 'deleted'))
    } else {
      pushChunk(targetChunks, tokenToChunk(operation.target, 'inserted'))
    }
  }

  return { baseChunks, targetChunks }
}

function tokensToChunks(tokens: NormalizedInlineToken[], status: InlineChunkStatus) {
  const chunks: InlineDiffChunk[] = []
  for (const token of tokens) {
    pushChunk(chunks, tokenToChunk(token, status))
  }
  return chunks
}

function tokenToChunk(
  token: NormalizedInlineToken,
  status: InlineChunkStatus,
  formatChange?: InlineFormatChange,
): InlineDiffChunk {
  return {
    status,
    value: token.value,
    ...(token.marks.length ? { marks: token.marks } : {}),
    ...(formatChange ? { formatChange } : {}),
  }
}

function diffTokensByLcs(
  baseTokens: NormalizedInlineToken[],
  targetTokens: NormalizedInlineToken[],
): InlineDiffOperation[] {
  const rows = baseTokens.length + 1
  const cols = targetTokens.length + 1
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0))

  for (let row = baseTokens.length - 1; row >= 0; row -= 1) {
    for (let col = targetTokens.length - 1; col >= 0; col -= 1) {
      table[row]![col] =
        baseTokens[row]!.value === targetTokens[col]!.value
          ? table[row + 1]![col + 1]! + 1
          : Math.max(table[row + 1]![col]!, table[row]![col + 1]!)
    }
  }

  const operations: InlineDiffOperation[] = []
  let row = 0
  let col = 0

  while (row < baseTokens.length && col < targetTokens.length) {
    if (baseTokens[row]!.value === targetTokens[col]!.value) {
      operations.push({
        status: 'equal',
        base: baseTokens[row]!,
        target: targetTokens[col]!,
      })
      row += 1
      col += 1
    } else if (table[row + 1]![col]! >= table[row]![col + 1]!) {
      operations.push({ status: 'deleted', base: baseTokens[row]! })
      row += 1
    } else {
      operations.push({ status: 'inserted', target: targetTokens[col]! })
      col += 1
    }
  }

  while (row < baseTokens.length) {
    operations.push({ status: 'deleted', base: baseTokens[row]! })
    row += 1
  }

  while (col < targetTokens.length) {
    operations.push({ status: 'inserted', target: targetTokens[col]! })
    col += 1
  }

  return operations
}

function diffTokensByPrefixSuffix(
  baseTokens: NormalizedInlineToken[],
  targetTokens: NormalizedInlineToken[],
): InlineDiffOperation[] {
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

  const operations: InlineDiffOperation[] = []
  for (let index = 0; index < prefix; index += 1) {
    operations.push({
      status: 'equal',
      base: baseTokens[index]!,
      target: targetTokens[index]!,
    })
  }
  for (let index = prefix; index <= baseSuffix; index += 1) {
    operations.push({ status: 'deleted', base: baseTokens[index]! })
  }
  for (let index = prefix; index <= targetSuffix; index += 1) {
    operations.push({ status: 'inserted', target: targetTokens[index]! })
  }

  let baseIndex = baseSuffix + 1
  let targetIndex = targetSuffix + 1
  while (baseIndex < baseTokens.length && targetIndex < targetTokens.length) {
    operations.push({
      status: 'equal',
      base: baseTokens[baseIndex]!,
      target: targetTokens[targetIndex]!,
    })
    baseIndex += 1
    targetIndex += 1
  }

  return operations
}

function pushChunk(chunks: InlineDiffChunk[], next: InlineDiffChunk) {
  if (!next.value) return
  const previous = chunks[chunks.length - 1]
  if (previous && chunksCanMerge(previous, next)) {
    previous.value += next.value
    return
  }
  chunks.push({ ...next })
}

function chunksCanMerge(left: InlineDiffChunk, right: InlineDiffChunk) {
  return (
    left.status === right.status &&
    normalizedMarksSignature(left.marks ?? []) === normalizedMarksSignature(right.marks ?? []) &&
    stableStringify(left.formatChange ?? null) === stableStringify(right.formatChange ?? null)
  )
}
