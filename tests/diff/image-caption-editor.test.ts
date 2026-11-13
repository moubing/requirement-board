// @vitest-environment happy-dom

import { Editor, Node } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import {
  createImageCaptionNavigationPlugin,
  leaveImageCaption,
  moveToNextImageCaption,
  moveToPreviousImageCaption,
} from '../../app/components/editor/image-caption-keyboard'

const ImageCaption = Node.create({
  name: 'imageCaption',
  priority: 110,
  content: 'inline*',
  defining: true,

  renderHTML() {
    return ['figcaption', 0]
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => leaveImageCaption(this.editor),
      ArrowDown: () => moveToNextImageCaption(this.editor),
      ArrowUp: () => moveToPreviousImageCaption(this.editor),
    }
  },

  addProseMirrorPlugins() {
    return [createImageCaptionNavigationPlugin()]
  },
})

const RequirementImage = Node.create({
  name: 'image',
  group: 'block',
  content: 'imageCaption',
  isolating: true,

  renderHTML() {
    return ['figure', 0]
  },
})

const editors: Editor[] = []
type CaptionEdge = 'start' | 'end'

function createEditor(content: Record<string, unknown>) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit, RequirementImage, ImageCaption, BlockId],
    content,
  })
  editors.push(editor)
  return editor
}

function pressEnter(editor: Editor) {
  return editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }),
  )
}

function pressArrowDown(editor: Editor) {
  return editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }),
  )
}

function pressArrowUp(editor: Editor) {
  return editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      code: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    }),
  )
}

function setCursorAtCaption(
  editor: Editor,
  captionIndex: number,
  edge: CaptionEdge,
) {
  let position = -1
  let currentCaptionIndex = 0
  editor.state.doc.descendants((node, nodePosition) => {
    if (position >= 0 || node.type.name !== 'imageCaption') return
    if (currentCaptionIndex === captionIndex) {
      position = nodePosition + 1 + (edge === 'end' ? node.content.size : 0)
    }
    currentCaptionIndex += 1
  })
  expect(position).toBeGreaterThanOrEqual(0)
  editor.commands.setTextSelection(position)
}

function setCursorAtCaptionEnd(editor: Editor) {
  setCursorAtCaption(editor, 0, 'end')
}

function imageNode(caption: string, diffId?: string) {
  return {
    type: 'image',
    attrs: diffId ? { diffId } : undefined,
    content: [
      {
        type: 'imageCaption',
        content: caption ? [{ type: 'text', text: caption }] : undefined,
      },
    ],
  }
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
})

describe('image caption keyboard behavior', () => {
  it('uses the paragraph below the image without creating a redundant one', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        imageNode('图片题注'),
        {
          type: 'paragraph',
          attrs: { diffId: 'para_after_image' },
          content: [{ type: 'text', text: '后续内容' }],
        },
      ],
    })
    setCursorAtCaptionEnd(editor)
    const documentBeforeEnter = editor.getJSON()

    pressEnter(editor)

    expect(editor.getJSON()).toEqual(documentBeforeEnter)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.textContent).toBe('后续内容')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
  })

  it('creates a cursor target below an image at the end of the document', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode('文末图片')],
    })
    setCursorAtCaptionEnd(editor)

    pressEnter(editor)

    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).attrs.diffId).toEqual(expect.any(String))
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
  })

  it('moves ArrowDown into the following image caption without changing the document', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode('第一张题注'), imageNode('第二张题注')],
    })
    setCursorAtCaptionEnd(editor)
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true)
    const documentBeforeArrowDown = editor.getJSON()

    pressArrowDown(editor)

    expect(editor.getJSON()).toEqual(documentBeforeArrowDown)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parent.textContent).toBe('第二张题注')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
  })

  it('moves ArrowDown from an empty caption without relying on browser line geometry', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode(''), imageNode('')],
    })
    setCursorAtCaptionEnd(editor)
    const endOfTextblock = vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false)
    const documentBeforeArrowDown = editor.getJSON()

    pressArrowDown(editor)

    expect(endOfTextblock).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(documentBeforeArrowDown)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(editor.state.selection.$from.before(1)).toBeGreaterThan(0)
  })

  it('moves ArrowUp into the preceding image caption without changing the document', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode('第一张题注'), imageNode('第二张题注')],
    })
    setCursorAtCaption(editor, 1, 'start')
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true)
    const documentBeforeArrowUp = editor.getJSON()

    pressArrowUp(editor)

    expect(editor.getJSON()).toEqual(documentBeforeArrowUp)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parent.textContent).toBe('第一张题注')
    expect(editor.state.selection.$from.parentOffset).toBe('第一张题注'.length)
  })

  it('moves ArrowUp from an empty caption without relying on browser line geometry', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode(''), imageNode('')],
    })
    setCursorAtCaption(editor, 1, 'start')
    const endOfTextblock = vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(false)
    const documentBeforeArrowUp = editor.getJSON()

    pressArrowUp(editor)

    expect(endOfTextblock).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(documentBeforeArrowUp)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(editor.state.selection.$from.before(1)).toBe(0)
  })

  it('inserts a paragraph between adjacent images when Enter is pressed', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode('第一张题注'), imageNode('第二张题注')],
    })
    setCursorAtCaptionEnd(editor)
    const childCountBeforeEnter = editor.state.doc.childCount
    const firstImageBeforeEnter = editor.state.doc.child(0).toJSON()
    const secondImageBeforeEnter = editor.state.doc.child(1).toJSON()

    pressEnter(editor)

    expect(editor.state.doc.childCount).toBe(childCountBeforeEnter + 1)
    expect(editor.state.doc.child(0).toJSON()).toEqual(firstImageBeforeEnter)
    expect(editor.state.doc.child(1).type.name).toBe('paragraph')
    expect(editor.state.doc.child(1).attrs.diffId).toEqual(expect.any(String))
    expect(editor.state.doc.child(1).textContent).toBe('')
    expect(editor.state.doc.child(2).toJSON()).toEqual(secondImageBeforeEnter)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
  })

  it('does not create content when ArrowDown has no following image caption', () => {
    const editor = createEditor({
      type: 'doc',
      content: [imageNode('文末图片')],
    })
    setCursorAtCaptionEnd(editor)
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true)
    const documentBeforeArrowDown = editor.getJSON()

    expect(moveToNextImageCaption(editor)).toBe(false)
    expect(editor.getJSON()).toEqual(documentBeforeArrowDown)
  })

  it('redirects a GapCursor between adjacent images into the following caption', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        imageNode('第一张题注', 'image_first'),
        imageNode('第二张题注', 'image_second'),
        {
          type: 'paragraph',
          attrs: { diffId: 'paragraph_after_images' },
        },
      ],
    })
    const documentBeforeSelectionChange = editor.getJSON()
    const positionBetweenImages = editor.state.doc.child(0).nodeSize
    const gapPosition = editor.state.doc.resolve(positionBetweenImages)

    editor.view.dispatch(
      editor.state.tr.setSelection(new GapCursor(gapPosition)),
    )

    expect(editor.state.selection).not.toBeInstanceOf(GapCursor)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parent.textContent).toBe('第二张题注')
    expect(editor.state.selection.$from.parentOffset).toBe(0)
    expect(editor.getJSON()).toEqual(documentBeforeSelectionChange)
  })

  it('redirects an upward GapCursor between adjacent images into the preceding caption', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        imageNode('第一张题注', 'image_first'),
        imageNode('第二张题注', 'image_second'),
        {
          type: 'paragraph',
          attrs: { diffId: 'paragraph_after_images' },
        },
      ],
    })
    setCursorAtCaption(editor, 1, 'start')
    const documentBeforeSelectionChange = editor.getJSON()
    const positionBetweenImages = editor.state.doc.child(0).nodeSize
    const gapPosition = editor.state.doc.resolve(positionBetweenImages)

    editor.view.dispatch(
      editor.state.tr.setSelection(new GapCursor(gapPosition)),
    )

    expect(editor.state.selection).not.toBeInstanceOf(GapCursor)
    expect(editor.state.selection.$from.parent.type.name).toBe('imageCaption')
    expect(editor.state.selection.$from.parent.textContent).toBe('第一张题注')
    expect(editor.state.selection.$from.parentOffset).toBe('第一张题注'.length)
    expect(editor.getJSON()).toEqual(documentBeforeSelectionChange)
  })

  it('keeps the normal Enter behavior outside image captions', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { diffId: 'para_normal' },
          content: [{ type: 'text', text: '普通段落' }],
        },
      ],
    })
    editor.commands.setTextSelection(3)

    pressEnter(editor)

    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).textContent).toBe('普通')
    expect(editor.state.doc.child(1).textContent).toBe('段落')
  })
})
