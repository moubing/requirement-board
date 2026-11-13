// @vitest-environment happy-dom

import StarterKit from '@tiptap/starter-kit'
import { Editor } from '@tiptap/vue-3'
import { gsap } from 'gsap'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import {
  attachDocumentLayoutMotion,
  describeStructuralLayoutChange,
  transactionMayChangeBlockStructure,
} from '../../app/components/editor/document-layout-motion'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from '../../app/components/editor/editor-layout-events'

const editors: Editor[] = []
const detachments: Array<() => void> = []

function createEditor(content: Record<string, unknown> = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { diffId: 'para_a' },
      content: [{ type: 'text', text: '第一段' }],
    },
    {
      type: 'paragraph',
      attrs: { diffId: 'para_b' },
      content: [{ type: 'text', text: '第二段' }],
    },
    {
      type: 'paragraph',
      attrs: { diffId: 'para_c' },
      content: [{ type: 'text', text: '第三段' }],
    },
  ],
}) {
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

function setRect(element: HTMLElement, top: number, height: number, width = 720) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    top,
    right: width,
    bottom: top + height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  })
}

function blockElement(editor: Editor, diffId: string) {
  const element = editor.view.dom.querySelector<HTMLElement>(`[data-diff-id="${diffId}"]`)
  expect(element).not.toBeNull()
  return element!
}

function setCursor(editor: Editor, text: string, edge: 'start' | 'end') {
  let position = -1
  editor.view.state.doc.descendants((node, nodePosition) => {
    if (position >= 0 || !node.isTextblock || node.textContent !== text) return
    position = nodePosition + 1 + (edge === 'end' ? node.content.size : 0)
  })
  expect(position).toBeGreaterThanOrEqual(0)
  editor.commands.setTextSelection(position)
}

function pressKey(editor: Editor, key: 'Enter' | 'Backspace') {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  }))
}

function createFrameScheduler() {
  let callback: FrameRequestCallback | null = null
  return {
    schedule: vi.fn((next: FrameRequestCallback) => {
      callback = next
      return 1
    }),
    cancel: vi.fn(() => {
      callback = null
    }),
    flush: () => {
      const next = callback
      callback = null
      next?.(0)
    },
  }
}

function attachTestMotion(editor: Editor) {
  const viewport = document.createElement('div')
  setRect(viewport, 0, 240)
  document.body.append(viewport)
  const scheduler = createFrameScheduler()
  const detach = attachDocumentLayoutMotion(editor, {
    getViewport: () => viewport,
    scheduleFrame: scheduler.schedule,
    cancelFrame: scheduler.cancel,
  })
  detachments.push(detach)
  return scheduler
}

function motionStyle() {
  return document.head.querySelector<HTMLStyleElement>('style[data-document-layout-motion-style]')
}

afterEach(() => {
  detachments.splice(0).forEach(detach => detach())
  editors.splice(0).forEach(editor => editor.destroy())
  gsap.globalTimeline.clear()
  document.head.querySelectorAll('style[data-document-layout-motion-style]').forEach(style => style.remove())
  document.body.replaceChildren()
})

describe('document block layout motion', () => {
  it('does not move visible blocks to a distant duplicate after a remote merge', () => {
    const editor = createEditor()
    setRect(blockElement(editor, 'para_a'), 20, 30)
    setRect(blockElement(editor, 'para_b'), 64, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    const scheduler = attachTestMotion(editor)
    const duplicate = editor.state.doc.firstChild!
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, duplicate).setMeta(ySyncPluginKey, { isChangeOrigin: true }))
    const copies = editor.view.dom.querySelectorAll<HTMLElement>('[data-diff-id="para_a"]')
    expect(copies).toHaveLength(2)
    setRect(copies[1]!, 4600, 30)
    scheduler.flush()

    expect(motionStyle()).toBeNull()
    expect(copies[0]!.getBoundingClientRect().top).toBe(20)
  })

  it('ignores an ordinary inline text transaction', () => {
    const editor = createEditor()
    const transaction = editor.view.state.tr.insertText('新', 2)

    expect(transactionMayChangeBlockStructure(transaction)).toBe(false)
    expect(describeStructuralLayoutChange(editor.view.state.doc, transaction.doc)).toBeNull()

    const scheduler = attachTestMotion(editor)
    editor.view.dispatch(transaction)

    expect(scheduler.schedule).not.toHaveBeenCalled()
    expect(motionStyle()).toBeNull()
  })

  it('animates existing following blocks when Enter inserts a paragraph', () => {
    const editor = createEditor()
    setRect(blockElement(editor, 'para_a'), 20, 30)
    setRect(blockElement(editor, 'para_b'), 64, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, '第一段', 'end')
    pressKey(editor, 'Enter')
    setRect(blockElement(editor, 'para_b'), 78, 30)
    setRect(blockElement(editor, 'para_c'), 122, 30)
    scheduler.flush()

    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_b"]')
    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_c"]')
    expect(motionStyle()?.textContent).toContain('translate3d(0px,-14px,0)')
  })

  it('animates a horizontal rule when content is inserted above it', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { diffId: 'para_before_rule' },
          content: [{ type: 'text', text: 'before' }],
        },
        {
          type: 'horizontalRule',
          attrs: { diffId: 'rule_a' },
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'para_after_rule' },
          content: [{ type: 'text', text: 'after' }],
        },
      ],
    })
    setRect(blockElement(editor, 'para_before_rule'), 20, 30)
    setRect(blockElement(editor, 'rule_a'), 64, 2)
    setRect(blockElement(editor, 'para_after_rule'), 80, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, 'before', 'end')
    pressKey(editor, 'Enter')
    setRect(blockElement(editor, 'rule_a'), 78, 2)
    setRect(blockElement(editor, 'para_after_rule'), 94, 30)
    scheduler.flush()

    expect(motionStyle()?.textContent).toContain('[data-diff-id="rule_a"]')
    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_after_rule"]')
    expect(motionStyle()?.textContent).toContain('translate3d(0px,-14px,0)')
  })

  it('animates visible blocks above the insertion when the viewport scroll position changes', () => {
    const editor = createEditor()
    setRect(blockElement(editor, 'para_a'), 20, 30)
    setRect(blockElement(editor, 'para_b'), 64, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, '第二段', 'end')
    pressKey(editor, 'Enter')
    setRect(blockElement(editor, 'para_a'), 6, 30)
    setRect(blockElement(editor, 'para_b'), 50, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    scheduler.flush()

    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_a"]')
    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_b"]')
    expect(motionStyle()?.textContent).not.toContain('[data-diff-id="para_c"]')
    expect(motionStyle()?.textContent).toContain('translate3d(0px,14px,0)')
  })

  it('animates the surviving following block when Backspace merges paragraphs', () => {
    const editor = createEditor()
    setRect(blockElement(editor, 'para_a'), 20, 30)
    setRect(blockElement(editor, 'para_b'), 64, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, '第二段', 'start')
    pressKey(editor, 'Backspace')
    setRect(blockElement(editor, 'para_c'), 64, 30)
    scheduler.flush()

    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_c"]')
    expect(motionStyle()?.textContent).not.toContain('[data-diff-id="para_b"]')
    expect(motionStyle()?.textContent).toContain('translate3d(0px,44px,0)')
  })

  it('captures following top-level blocks when Enter inserts a list item', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { diffId: 'list_a' },
          content: [
            {
              type: 'listItem',
              attrs: { diffId: 'item_a' },
              content: [
                {
                  type: 'paragraph',
                  attrs: { diffId: 'item_para_a' },
                  content: [{ type: 'text', text: '列表内容' }],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'para_after_list' },
          content: [{ type: 'text', text: '列表后内容' }],
        },
      ],
    })
    setRect(blockElement(editor, 'list_a'), 20, 40)
    setRect(blockElement(editor, 'para_after_list'), 74, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, '列表内容', 'end')
    pressKey(editor, 'Enter')
    setRect(blockElement(editor, 'para_after_list'), 88, 30)
    scheduler.flush()

    expect(motionStyle()?.textContent).toContain('[data-diff-id="para_after_list"]')
    expect(motionStyle()?.textContent).toContain('translate3d(0px,-14px,0)')
  })

  it('cleans the external transform stylesheet after the animation', async () => {
    const editor = createEditor()
    const layoutFrame = vi.fn()
    editor.view.dom.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, layoutFrame)
    setRect(blockElement(editor, 'para_a'), 20, 30)
    setRect(blockElement(editor, 'para_b'), 64, 30)
    setRect(blockElement(editor, 'para_c'), 108, 30)
    const scheduler = attachTestMotion(editor)

    setCursor(editor, '第一段', 'end')
    pressKey(editor, 'Enter')
    setRect(blockElement(editor, 'para_b'), 78, 30)
    setRect(blockElement(editor, 'para_c'), 122, 30)
    scheduler.flush()
    expect(motionStyle()).not.toBeNull()

    await new Promise(resolve => window.setTimeout(resolve, 320))
    expect(motionStyle()).toBeNull()
    expect(document.querySelector('[data-document-layout-motion-scope]')).toBeNull()
    expect(layoutFrame).toHaveBeenCalled()
  })
})
