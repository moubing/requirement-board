// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import { BLOCK_NODE_TYPES } from '../../shared/editor/document'

const editors: Editor[] = []

function createEditor(content: Record<string, unknown>) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), BlockId],
    content,
  })
  editors.push(editor)
  return editor
}

function pressEnter(editor: Editor) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }),
  )
}

function setCursor(editor: Editor, nodeText: string, offset: 'start' | 'end') {
  let position = -1
  editor.state.doc.descendants((node, nodePosition) => {
    if (position >= 0 || node.textContent !== nodeText || !node.isTextblock) return
    position = nodePosition + 1 + (offset === 'end' ? node.content.size : 0)
  })
  expect(position).toBeGreaterThanOrEqual(0)
  editor.commands.setTextSelection(position)
}

function expectStableBlockIds(editor: Editor) {
  const blockTypes = new Set<string>(BLOCK_NODE_TYPES)
  const diffIds: string[] = []
  editor.state.doc.descendants((node) => {
    if (!blockTypes.has(node.type.name)) return
    expect(node.attrs.diffId).toEqual(expect.any(String))
    expect(node.attrs.diffId).not.toBe('')
    diffIds.push(node.attrs.diffId as string)
  })
  expect(new Set(diffIds).size).toBe(diffIds.length)
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
})

describe('BlockId editor keyboard behavior', () => {
  it('assigns a stable id to a horizontal rule inserted at runtime', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { diffId: 'para_before_rule' },
          content: [{ type: 'text', text: 'before' }],
        },
      ],
    })

    editor.commands.setHorizontalRule()

    const horizontalRule = Array.from(
      { length: editor.state.doc.childCount },
      (_, index) => editor.state.doc.child(index),
    ).find((node) => node.type.name === 'horizontalRule')
    expect(horizontalRule?.attrs.diffId).toMatch(/^hori_/)
    expect(editor.view.dom.querySelector(`hr[data-diff-id="${horizontalRule?.attrs.diffId}"]`)).not.toBeNull()
    expectStableBlockIds(editor)
  })

  it('keeps typing in the new paragraph inserted before a heading', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { diffId: 'head_quick_start', level: 2 },
          content: [{ type: 'text', text: '快速开始' }],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'para_after' },
          content: [{ type: 'text', text: '后续内容' }],
        },
      ],
    })
    setCursor(editor, '快速开始', 'start')

    pressEnter(editor)
    expect(editor.state.selection.$from.parent.type.name).toBe('heading')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    editor.commands.insertContent('标题光标测试')

    expect(
      Array.from({ length: editor.state.doc.childCount }, (_, index) => ({
        type: editor.state.doc.child(index).type.name,
        text: editor.state.doc.child(index).textContent,
      })),
    ).toEqual([
      { type: 'paragraph', text: '' },
      { type: 'heading', text: '标题光标测试快速开始' },
      { type: 'paragraph', text: '后续内容' },
    ])
    expectStableBlockIds(editor)
  })

  it('keeps typing after leaving a list with two Enter presses', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { diffId: 'bull_features' },
          content: [
            {
              type: 'listItem',
              attrs: { diffId: 'list_last' },
              content: [
                {
                  type: 'paragraph',
                  attrs: { diffId: 'para_last' },
                  content: [{ type: 'text', text: '展示需求的修改记录' }],
                },
              ],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { diffId: 'head_stack', level: 2 },
          content: [{ type: 'text', text: '技术栈' }],
        },
      ],
    })
    setCursor(editor, '展示需求的修改记录', 'end')

    pressEnter(editor)
    pressEnter(editor)
    editor.commands.insertContent('列表光标测试')

    expect(editor.state.doc.child(0).type.name).toBe('bulletList')
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).textContent).toBe('列表光标测试')
    expect(editor.state.doc.child(2).type.name).toBe('heading')
    expect(editor.state.doc.child(2).textContent).toBe('技术栈')
    expectStableBlockIds(editor)
  })
})
