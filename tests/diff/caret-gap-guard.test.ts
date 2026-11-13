// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import {
  handleCaretGapClick,
  isCaretGapPoint,
  type CaretGapBoundary,
} from '../../app/components/editor/caret-gap-guard-extension'

const editors: Editor[] = []

function domRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function createListEditor() {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit, BlockId],
    content: {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { diffId: 'list_gap' },
          content: [
            {
              type: 'listItem',
              attrs: { diffId: 'item_before' },
              content: [
                {
                  type: 'paragraph',
                  attrs: { diffId: 'paragraph_before' },
                  content: [{ type: 'text', text: '上一项' }],
                },
              ],
            },
            {
              type: 'listItem',
              attrs: { diffId: 'item_after' },
              content: [
                {
                  type: 'paragraph',
                  attrs: { diffId: 'paragraph_after' },
                  content: [{ type: 'text', text: '下一项' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'paragraph_after_list' },
        },
      ],
    },
  })
  editors.push(editor)

  const paragraphs = editor.view.dom.querySelectorAll<HTMLElement>('ol p[data-diff-id]')
  expect(paragraphs).toHaveLength(2)
  paragraphs[0]!.getBoundingClientRect = () => domRect(80, 10, 500, 30)
  paragraphs[1]!.getBoundingClientRect = () => domRect(80, 50, 500, 70)

  return {
    editor,
    list: editor.view.dom.querySelector('ol')!,
    paragraphs,
  }
}

function gapClick(target: EventTarget, y: number, overrides: Partial<MouseEvent> = {}) {
  return {
    altKey: false,
    button: 0,
    clientX: 160,
    clientY: y,
    ctrlKey: false,
    defaultPrevented: false,
    detail: 1,
    metaKey: false,
    shiftKey: false,
    target,
    ...overrides,
  } as MouseEvent
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren()
})

describe('caret gap guard', () => {
  it('recognizes the full short gap without choosing either adjacent block', () => {
    const boundaries: CaretGapBoundary[] = [
      { start: 1, end: 5, left: 80, right: 500, top: 10, bottom: 30 },
      { start: 8, end: 12, left: 80, right: 500, top: 50, bottom: 70 },
    ]

    expect(isCaretGapPoint(boundaries, { x: 160, y: 36 })).toBe(true)
    expect(isCaretGapPoint(boundaries, { x: 160, y: 40 })).toBe(true)
    expect(isCaretGapPoint(boundaries, { x: 160, y: 46 })).toBe(true)
  })

  it('does not treat a large structural gap or a textblock body as a guarded gap', () => {
    const boundaries: CaretGapBoundary[] = [
      { start: 1, end: 5, left: 80, right: 500, top: 10, bottom: 30 },
      { start: 8, end: 12, left: 80, right: 500, top: 90, bottom: 110 },
    ]

    expect(isCaretGapPoint(boundaries, { x: 160, y: 50 })).toBe(false)
    expect(isCaretGapPoint(boundaries, { x: 160, y: 20 })).toBe(false)
  })

  it('consumes single and consecutive clicks anywhere in a short list gap without changing state', () => {
    const { editor, list } = createListEditor()
    const selectionBeforeClick = editor.state.selection
    const contentBeforeClick = editor.getJSON()

    expect(handleCaretGapClick(editor.view, gapClick(list, 36))).toBe(true)
    expect(handleCaretGapClick(editor.view, gapClick(list, 46))).toBe(true)
    expect(handleCaretGapClick(editor.view, gapClick(list, 40, { detail: 2 }))).toBe(true)
    expect(handleCaretGapClick(editor.view, gapClick(list, 40, { detail: 3 }))).toBe(true)
    expect(editor.state.selection.eq(selectionBeforeClick)).toBe(true)
    expect(editor.getJSON()).toEqual(contentBeforeClick)
  })

  it('preserves direct text clicks, modified clicks, and double-click selection', () => {
    const { editor, list, paragraphs } = createListEditor()
    const selectionBeforeClick = editor.state.selection

    expect(handleCaretGapClick(editor.view, gapClick(paragraphs[0]!, 20))).toBe(false)
    expect(handleCaretGapClick(editor.view, gapClick(list, 36, { shiftKey: true }))).toBe(false)
    expect(handleCaretGapClick(editor.view, gapClick(paragraphs[0]!, 20, { detail: 2 }))).toBe(false)
    expect(editor.state.selection.eq(selectionBeforeClick)).toBe(true)
  })
})
