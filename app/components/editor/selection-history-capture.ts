import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { AllSelection, TextSelection } from '@tiptap/pm/state'

import {
  extractSelectionHistoryBlocks,
  type SelectionHistoryAnchor,
  type SelectionHistoryBlock,
  type SelectionHistorySegment,
} from '../../../shared/diff/selection-history'

export type SelectionHistoryCaptureResult =
  | { ok: true; anchor: SelectionHistoryAnchor }
  | { ok: false; message: string }

interface PositionedLogicalBlock {
  node: ProseMirrorNode
  block: SelectionHistoryBlock
  contentStart: number
  contentEnd: number
}

const UNSUPPORTED_BLOCK_TYPES = new Set(['horizontalRule', 'table'])

export function captureSelectionHistoryAnchor(editor: Editor): SelectionHistoryCaptureResult {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection) && !(selection instanceof AllSelection)) {
    return {
      ok: false,
      message: '当前节点不是连续文本，暂时无法查看选区历史',
    }
  }

  const positionedBlocks = positionLogicalBlocks(editor)
  if (!positionedBlocks.length) {
    return {
      ok: false,
      message: '当前文档没有可追踪的文字块',
    }
  }

  if (selection.empty) {
    const current = findCurrentBlock(positionedBlocks, selection.from)
    if (!current || UNSUPPORTED_BLOCK_TYPES.has(current.node.type.name) || !current.block.tokens.length) {
      return {
        ok: false,
        message: '请把光标放在正文、标题、列表或引用文字中再查看历史',
      }
    }

    const segment: SelectionHistorySegment = {
      blockId: current.block.id,
      blockType: current.block.type,
      start: 0,
      end: current.block.tokens.length,
      text: current.block.text,
      wholeBlock: true,
    }
    return {
      ok: true,
      anchor: {
        text: current.block.text,
        segments: [segment],
        scope: 'block',
      },
    }
  }

  const segments: SelectionHistorySegment[] = []
  for (const positioned of positionedBlocks) {
    if (UNSUPPORTED_BLOCK_TYPES.has(positioned.node.type.name)) continue
    const intersectionStart = Math.max(selection.from, positioned.contentStart)
    const intersectionEnd = Math.min(selection.to, positioned.contentEnd)
    if (intersectionStart >= intersectionEnd) continue

    const localStart = intersectionStart - positioned.contentStart
    const localEnd = intersectionEnd - positioned.contentStart
    const prefix = positioned.node.textBetween(0, localStart, '\n', '\n')
    const selectedText = positioned.node.textBetween(localStart, localEnd, '\n', '\n')
    const start = clamp(codePointLength(prefix), 0, positioned.block.tokens.length)
    const selectedLength = codePointLength(selectedText)
    const end = clamp(start + selectedLength, start, positioned.block.tokens.length)
    if (start === end) continue

    segments.push({
      blockId: positioned.block.id,
      blockType: positioned.block.type,
      start,
      end,
      text: positioned.block.tokens.slice(start, end).map((token) => token.value).join(''),
    })
  }

  if (!segments.length) {
    return {
      ok: false,
      message: selection.from < doc.content.size && selection.to > 0
        ? '该选区不包含可追踪的连续文字'
        : '请先选择一段文字',
    }
  }

  return {
    ok: true,
    anchor: {
      text: segments.map((segment) => segment.text).join('\n'),
      segments,
      scope: 'selection',
    },
  }
}

function positionLogicalBlocks(editor: Editor) {
  const normalizedBlocks = extractSelectionHistoryBlocks(editor.getJSON())
  const blocksById = new Map(normalizedBlocks.map((block) => [block.id, block]))
  const positioned: PositionedLogicalBlock[] = []

  editor.state.doc.descendants((node, position) => {
    if (!blocksById.has(node.attrs.diffId)) return true
    addPositionedBlock(positioned, blocksById, node, position)
    return false
  })

  return positioned
}

function addPositionedBlock(
  positioned: PositionedLogicalBlock[],
  blocksById: Map<string, SelectionHistoryBlock>,
  node: ProseMirrorNode,
  nodePosition: number,
) {
  const diffId = typeof node.attrs.diffId === 'string' ? node.attrs.diffId : ''
  if (!diffId) return
  const block = blocksById.get(diffId)
  if (!block) return
  const contentStart = nodePosition + 1
  positioned.push({
    node,
    block,
    contentStart,
    contentEnd: contentStart + node.content.size,
  })
}

function findCurrentBlock(blocks: PositionedLogicalBlock[], position: number) {
  const containing = blocks.filter(
    (block) => position >= block.contentStart && position <= block.contentEnd,
  )
  return containing.find((block) => block.contentStart <= position && position < block.contentEnd)
    ?? containing[0]
    ?? null
}

function codePointLength(value: string) {
  return Array.from(value).length
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}
