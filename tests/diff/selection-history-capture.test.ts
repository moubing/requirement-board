// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import { captureSelectionHistoryAnchor } from '../../app/components/editor/selection-history-capture'

const editors: Editor[] = []

function createEditor(content: Record<string, unknown>) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit, BlockId],
    content,
  })
  editors.push(editor)
  return editor
}

function textPosition(editor: Editor, text: string, offset: number) {
  let position = -1
  editor.state.doc.descendants((node, nodePosition) => {
    if (position >= 0 || !node.isText || node.text !== text) return
    position = nodePosition + offset
  })
  expect(position).toBeGreaterThanOrEqual(0)
  return position
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
})

describe('selection history capture', () => {
  it('captures an exact range inside a text block', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { diffId: 'para_one' },
        content: [{ type: 'text', text: 'before selected after' }],
      }],
    })
    editor.commands.setTextSelection({
      from: textPosition(editor, 'before selected after', 7),
      to: textPosition(editor, 'before selected after', 15),
    })

    expect(captureSelectionHistoryAnchor(editor)).toEqual({
      ok: true,
      anchor: {
        text: 'selected',
        scope: 'selection',
        segments: [{
          blockId: 'para_one',
          blockType: 'paragraph',
          start: 7,
          end: 15,
          text: 'selected',
        }],
      },
    })
  })

  it('captures each logical block in a cross-paragraph selection', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { diffId: 'para_first' },
          content: [{ type: 'text', text: 'first' }],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'para_second' },
          content: [{ type: 'text', text: 'second' }],
        },
      ],
    })
    editor.commands.setTextSelection({
      from: textPosition(editor, 'first', 2),
      to: textPosition(editor, 'second', 3),
    })

    const result = captureSelectionHistoryAnchor(editor)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anchor.text).toBe('rst\nsec')
    expect(result.anchor.segments.map(({ blockId, start, end, text }) => ({ blockId, start, end, text }))).toEqual([
      { blockId: 'para_first', start: 2, end: 5, text: 'rst' },
      { blockId: 'para_second', start: 0, end: 3, text: 'sec' },
    ])
  })

  it('uses the complete direct list item as the logical history block', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'bulletList',
        attrs: { diffId: 'list_one' },
        content: [{
          type: 'listItem',
          attrs: { diffId: 'item_one' },
          content: [{
            type: 'paragraph',
            attrs: { diffId: 'para_in_item' },
            content: [{ type: 'text', text: 'list history' }],
          }],
        }],
      }],
    })
    editor.commands.setTextSelection(textPosition(editor, 'list history', 4))

    const result = captureSelectionHistoryAnchor(editor)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anchor.scope).toBe('block')
    expect(result.anchor.segments).toEqual([{
      blockId: 'item_one',
      blockType: 'listItem',
      start: 0,
      end: 12,
      text: 'list history',
      wholeBlock: true,
    }])
  })

  it('captures Ctrl+A as a cross-block text history selection', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { diffId: 'para_all_first' },
          content: [{ type: 'text', text: 'first' }],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'para_all_second' },
          content: [{ type: 'text', text: 'second' }],
        },
      ],
    })
    editor.commands.selectAll()

    const result = captureSelectionHistoryAnchor(editor)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anchor.scope).toBe('selection')
    expect(result.anchor.text).toBe('first\nsecond')
    expect(result.anchor.segments.map((segment) => segment.blockId)).toEqual([
      'para_all_first',
      'para_all_second',
    ])
  })

  it('keeps Shift+Enter hard breaks in the captured range', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: { diffId: 'para_break' },
        content: [
          { type: 'text', text: 'first' },
          { type: 'hardBreak' },
          { type: 'text', text: 'second' },
        ],
      }],
    })
    editor.commands.selectAll()

    const result = captureSelectionHistoryAnchor(editor)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.anchor.text).toBe('first\nsecond')
    expect(result.anchor.segments[0]).toMatchObject({
      start: 0,
      end: 12,
      text: 'first\nsecond',
    })
  })

  it('rejects a cursor on a non-text block', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'horizontalRule', attrs: { diffId: 'rule_one' } },
        { type: 'paragraph', attrs: { diffId: 'para_after' } },
      ],
    })
    editor.commands.setNodeSelection(0)

    expect(captureSelectionHistoryAnchor(editor)).toEqual({
      ok: false,
      message: '当前节点不是连续文本，暂时无法查看选区历史',
    })
  })
})
