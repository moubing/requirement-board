// @vitest-environment happy-dom

import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addImageUploadPlaceholder,
  clearImageUploadPlaceholders,
  findImageUploadCaretAnchor,
  findImageUploadPlaceholderPosition,
  ImageUploadPlaceholder,
  imageUploadPlaceholderPluginKey,
  removeImageUploadPlaceholder,
  updateImageUploadPlaceholder,
} from '../../app/components/editor/image-upload-placeholder'
import { createEmptyCaretAnchorDecorations } from '../../app/components/editor/smooth-caret-extension'

const editors: Editor[] = []

const TestImageCaption = Node.create({
  name: 'imageCaption',
  content: 'inline*',
  renderHTML: () => ['figcaption', 0],
})

const TestImage = Node.create({
  name: 'image',
  group: 'block',
  content: 'imageCaption',
  addAttributes: () => ({ src: { default: null }, diffId: { default: null } }),
  renderHTML: () => ['figure', 0],
})

function createEditor() {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: [StarterKit, TestImageCaption, TestImage, ImageUploadPlaceholder],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '正文' }],
        },
      ],
    },
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('image upload placeholder', () => {
  it.each(['empty', 'start', 'middle', 'end'])('preserves every pending upload when inserting a block image at %s', (location) => {
    const editor = createEditor()
    if (location === 'empty') editor.commands.setContent('<p></p>')
    const position = location === 'end' ? 3 : location === 'middle' ? 2 : 1
    for (let order = 1; order <= 3; order++) {
      addImageUploadPlaceholder(editor.view, { id: `upload_${order}`, fileName: 'image.png', status: 'uploading', order }, position)
    }
    for (let order = 1; order <= 3; order++) {
      const pendingPosition = findImageUploadPlaceholderPosition(editor.view, `upload_${order}`)
      expect(pendingPosition).toBeDefined()
      expect(editor.chain().setMeta(imageUploadPlaceholderPluginKey, { type: 'insert', id: `upload_${order}`, imageDiffId: `image_${order}` })
        .insertContentAt(pendingPosition!, { type: 'image', attrs: { src: `${order}.png`, diffId: `image_${order}` }, content: [{ type: 'imageCaption' }] }, { updateSelection: false }).run()).toBe(true)
      expect(removeImageUploadPlaceholder(editor.view, `upload_${order}`)).toBe(true)
      expect(editor.view.dom.querySelectorAll('.requirement-image-upload')).toHaveLength(3 - order)
    }
    const images: string[] = []
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs.src) })
    expect(images).toEqual(['1.png', '2.png', '3.png'])
    expect(editor.state.doc.textContent).toBe(location === 'empty' ? '' : '正文')
  })

  it('keeps a failed earlier upload before a later completed image', () => {
    const editor = createEditor()
    for (let order = 1; order <= 3; order++) {
      addImageUploadPlaceholder(editor.view, { id: `upload_${order}`, fileName: 'image.png', status: 'uploading', order }, 3)
    }
    updateImageUploadPlaceholder(editor.view, 'upload_1', { status: 'error', errorMessage: '网络失败' })
    for (const order of [2, 3, 1]) {
      editor.chain().setMeta(imageUploadPlaceholderPluginKey, { type: 'insert', id: `upload_${order}`, imageDiffId: `image_${order}` })
        .insertContentAt(findImageUploadPlaceholderPosition(editor.view, `upload_${order}`)!,
          { type: 'image', attrs: { src: `${order}.png`, diffId: `image_${order}` }, content: [{ type: 'imageCaption' }] }, { updateSelection: false }).run()
      expect(removeImageUploadPlaceholder(editor.view, `upload_${order}`)).toBe(true)
    }
    expect(editor.getJSON().content?.filter(node => node.type === 'image').map(node => node.attrs?.src)).toEqual(['1.png', '2.png', '3.png'])
  })

  it('keeps pending uploads after deleting their text and only removes them explicitly', () => {
    const editor = createEditor()
    addImageUploadPlaceholder(editor.view, { id: 'upload_delete', fileName: 'image.png', status: 'uploading', order: 1 }, 2)
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    expect(findImageUploadPlaceholderPosition(editor.view, 'upload_delete')).toBeDefined()
    expect(updateImageUploadPlaceholder(editor.view, 'upload_delete', { status: 'error' })).toBe(true)
    clearImageUploadPlaceholders(editor.view)
    editor.commands.insertContent('继续输入')
    expect(findImageUploadPlaceholderPosition(editor.view, 'upload_delete')).toBeUndefined()
  })

  it.each(['paragraph-start', 'after-hard-break'])('keeps the upload caret anchor stable at %s while typing', (position) => {
    const editor = createEditor()
    if (position === 'after-hard-break') {
      editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: '前行' }, { type: 'hardBreak' }, { type: 'text', text: '后行' },
      ] }] })
    }
    editor.commands.setTextSelection(position === 'paragraph-start' ? 1 : 4)
    const before = editor.getJSON()
    expect(createEmptyCaretAnchorDecorations(editor.state).find()).toHaveLength(0)
    addImageUploadPlaceholder(editor.view, { id: 'line-start', fileName: 'image.png', status: 'uploading', order: 1 })
    const anchor = findImageUploadCaretAnchor(editor.view, editor.state.selection.head)
    expect(anchor?.textContent).toBe('\u200b')
    expect(createEmptyCaretAnchorDecorations(editor.state).find()).toHaveLength(0)
    expect(editor.getJSON()).toEqual(before)
    editor.commands.insertContent('继续')
    expect(findImageUploadCaretAnchor(editor.view, editor.state.selection.head)).toBe(anchor)
    expect(createEmptyCaretAnchorDecorations(editor.state).find()).toHaveLength(0)
    expect(findImageUploadPlaceholderPosition(editor.view, 'line-start')).toBe(editor.state.selection.head)
  })

  it('renders immediately without changing the persisted document', () => {
    const editor = createEditor()
    const contentBeforeUpload = editor.getJSON()

    editor.commands.setTextSelection(2)
    addImageUploadPlaceholder(editor.view, {
      id: 'upload_1',
      fileName: 'screenshot.png',
      previewUrl: 'blob:preview-1',
      width: 640,
      height: 360,
      status: 'uploading',
      order: 1,
    })

    const placeholder = editor.view.dom.querySelector<HTMLElement>('[data-image-upload-id="upload_1"]')
    expect(placeholder?.dataset.status).toBe('uploading')
    expect(placeholder?.textContent).toContain('图片上传中')
    expect(placeholder?.querySelector('img')?.getAttribute('src')).toBe('blob:preview-1')
    expect(placeholder?.style.width).toBe('100%')
    expect(placeholder?.style.maxWidth).toBe('640px')
    expect(placeholder?.querySelector<HTMLElement>('.requirement-image-upload__frame')?.style.aspectRatio)
      .toBe('640 / 360')
    expect(editor.getJSON()).toEqual(contentBeforeUpload)
  })

  it('reports the local preview dimensions without changing the document', () => {
    const editor = createEditor()
    const previewReady = vi.fn()
    editor.view.dom.addEventListener('requirement-image-upload-preview-ready', previewReady)

    addImageUploadPlaceholder(editor.view, {
      id: 'upload_dimensions',
      fileName: 'dimensions.png',
      previewUrl: 'blob:dimensions',
      status: 'uploading',
      order: 1,
    })

    const image = editor.view.dom.querySelector<HTMLImageElement>('[data-image-upload-id="upload_dimensions"] img')!
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1600 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 900 })
    image.dispatchEvent(new Event('load'))

    expect(previewReady).toHaveBeenCalledOnce()
    expect((previewReady.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      id: 'upload_dimensions',
      naturalWidth: 1600,
      naturalHeight: 900,
    })
  })

  it('tracks its original position while the document changes', () => {
    const editor = createEditor()
    editor.commands.setTextSelection(2)
    addImageUploadPlaceholder(editor.view, {
      id: 'upload_mapped',
      fileName: 'mapped.png',
      status: 'uploading',
      order: 1,
    })
    const originalPosition = findImageUploadPlaceholderPosition(editor.view, 'upload_mapped')

    editor.commands.insertContentAt(1, '前')

    expect(findImageUploadPlaceholderPosition(editor.view, 'upload_mapped')).toBe((originalPosition ?? 0) + 1)
  })

  it('can replace the mapped position with a block image without moving the current selection', () => {
    const editor = createEditor()
    editor.commands.setTextSelection(2)
    addImageUploadPlaceholder(editor.view, {
      id: 'upload_resolved',
      fileName: 'resolved.png',
      status: 'uploading',
      order: 1,
    })
    editor.commands.setTextSelection(3)
    const selectionBeforeResolve = editor.state.selection.from
    const position = findImageUploadPlaceholderPosition(editor.view, 'upload_resolved')

    expect(position).toBeDefined()
    expect(editor.commands.insertContentAt(
      position!,
      { type: 'image', content: [{ type: 'imageCaption' }] },
      { updateSelection: false },
    )).toBe(true)
    expect(removeImageUploadPlaceholder(editor.view, 'upload_resolved')).toBe(true)

    expect(editor.getJSON().content?.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph'])
    expect(editor.state.selection.from).toBeGreaterThan(selectionBeforeResolve)
    expect(editor.state.selection.$from.parent.textContent).toBe('文')
    expect(editor.state.selection.$from.parentOffset).toBe(1)
  })

  it('shows retry and remove actions after a failure', () => {
    const editor = createEditor()
    const retry = vi.fn()
    const dismiss = vi.fn()
    editor.view.dom.addEventListener('requirement-image-upload-retry', retry)
    editor.view.dom.addEventListener('requirement-image-upload-dismiss', dismiss)

    addImageUploadPlaceholder(editor.view, {
      id: 'upload_failed',
      fileName: 'failed.png',
      status: 'uploading',
      order: 1,
    })
    expect(updateImageUploadPlaceholder(editor.view, 'upload_failed', {
      status: 'error',
      errorMessage: '网络连接失败',
    })).toBe(true)

    const placeholder = editor.view.dom.querySelector<HTMLElement>('[data-image-upload-id="upload_failed"]')
    expect(placeholder?.dataset.status).toBe('error')
    expect(placeholder?.textContent).toContain('网络连接失败')

    const buttons = placeholder?.querySelectorAll<HTMLButtonElement>('button') ?? []
    buttons[0]?.click()
    buttons[1]?.click()
    expect(retry).toHaveBeenCalledOnce()
    expect((retry.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ id: 'upload_failed' })
    expect(dismiss).toHaveBeenCalledOnce()

    expect(removeImageUploadPlaceholder(editor.view, 'upload_failed')).toBe(true)
    expect(editor.view.dom.querySelector('[data-image-upload-id="upload_failed"]')).toBeNull()
  })
})
