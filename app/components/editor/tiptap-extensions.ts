import { Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'

import { createDiffId, normalizeImageAlignment } from '~~/shared/editor/document'
import {
  createImageCaptionNavigationPlugin,
  leaveImageCaption,
  moveToNextImageCaption,
  moveToPreviousImageCaption,
} from './image-caption-keyboard'
import RequirementImageNode from './RequirementImageNode.vue'
import RequirementCalloutNode from './RequirementCalloutNode.vue'
import { isCalloutTone, type CalloutTone } from '~~/shared/editor/callout'

export { BlockId } from './block-id-extension'
export { EditorClipboard, MarkdownPaste } from './clipboard-extension'

function parseImageDimension(value: string | null) {
  if (!value) return null
  const number = Number.parseFloat(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null
}

function imageAttributesFromElement(element: HTMLElement, allowBase64: boolean) {
  const image = element.tagName === 'IMG' ? element : element.querySelector('img')
  const src = image?.getAttribute('src')?.trim()
  if (!src || (!allowBase64 && /^data:/i.test(src))) return false
  const figure = element.tagName === 'FIGURE' ? element : element.closest('figure[data-requirement-image]')
  return {
    src,
    alt: image?.getAttribute('alt') ?? null,
    title: image?.getAttribute('title') ?? null,
    width: parseImageDimension(image?.getAttribute('width') ?? element.getAttribute('data-width')),
    height: parseImageDimension(image?.getAttribute('height') ?? element.getAttribute('data-height')),
    align: normalizeImageAlignment(figure?.getAttribute('data-image-align')),
  }
}

export const ImageCaption = Node.create({
  name: 'imageCaption',
  priority: 110,
  content: 'inline*',
  defining: true,

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

  parseHTML() {
    return [{ tag: 'span[data-image-caption-content]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-image-caption-content': '',
        'data-placeholder': '添加图片题注…',
      }),
      0,
    ]
  },
})

export const RequirementImage = Image.extend({
  content: 'imageCaption',
  isolating: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'center',
        parseHTML: (element) => normalizeImageAlignment(element.getAttribute('data-image-align')),
        renderHTML: (attributes) => ({
          'data-image-align': normalizeImageAlignment(attributes.align),
        }),
      },
    }
  },

  parseHTML() {
    const imageSelector = this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])'
    return [
      {
        tag: 'figure[data-requirement-image]',
        contentElement: 'figcaption',
        getAttrs: (element) => imageAttributesFromElement(element as HTMLElement, this.options.allowBase64),
      },
      {
        tag: imageSelector,
        getAttrs: (element) => imageAttributesFromElement(element as HTMLElement, this.options.allowBase64),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const { src, alt, title, width, height, ...figureAttributes } = HTMLAttributes
    return [
      'figure',
      mergeAttributes(figureAttributes, { 'data-requirement-image': '' }),
      ['img', { src, alt, title, width, height }],
      ['figcaption', 0],
    ]
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode(
      'image',
      {
        src: token.href,
        title: token.title,
        alt: token.text,
      },
      [helpers.createNode('imageCaption')],
    ),

  renderMarkdown: (node) => {
    const src = node.attrs?.src ?? ''
    const alt = node.attrs?.alt ?? ''
    const title = node.attrs?.title ?? ''
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
  },

  addNodeView() {
    return VueNodeViewRenderer(RequirementImageNode, { contentDOMElementTag: 'span' })
  },

  addKeyboardShortcuts() {
    const deleteSelectedImage = () => {
      const { selection } = this.editor.state
      if (!(selection instanceof NodeSelection) || selection.node.type !== this.type) return false
      return this.editor.commands.deleteSelection()
    }

    return {
      Backspace: deleteSelectedImage,
      Delete: deleteSelectedImage,
    }
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: options,
            content: [{ type: 'imageCaption' }],
          }),
    }
  },
})

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,

  addNodeView() {
    return VueNodeViewRenderer(RequirementCalloutNode)
  },

  addAttributes() {
    return {
      diffId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-diff-id'),
        renderHTML: (attributes) => {
          if (!attributes.diffId) return {}
          return { 'data-diff-id': attributes.diffId }
        },
      },
      tone: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-tone') ?? 'note',
        renderHTML: (attributes) => ({ 'data-tone': attributes.tone ?? 'note' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-requirement-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'section',
      mergeAttributes(HTMLAttributes, {
        'data-requirement-callout': '',
        class: 'requirement-callout',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      insertCallout:
        (attrs?: { tone?: CalloutTone; text?: string }) =>
        ({ tr, dispatch, editor }) => {
          const tone = attrs?.tone === undefined ? 'note' : attrs.tone
          if (!editor.isEditable || !isCalloutTone(tone)) return false
          const { $from, $to } = tr.selection
          if ($from.parent.type.name !== 'paragraph' || !$from.sameParent($to)) return false
          if (dispatch) {
            const from = $from.before()
            const to = $from.after()
            const empty = $from.parent.content.size === 0
            const position = empty ? from : to
            const node = this.type.create({ diffId: createDiffId('call'), tone }, attrs?.text ? editor.schema.text(attrs.text) : undefined)
            tr.replaceWith(position, empty ? to : position, node)
            tr.setSelection(TextSelection.create(tr.doc, position + 1)).scrollIntoView()
          }
          return true
        },
    }
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: (attrs?: { tone?: CalloutTone; text?: string }) => ReturnType
    }
  }
}
