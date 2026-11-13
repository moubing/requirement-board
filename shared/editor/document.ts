import { nanoid } from 'nanoid'

export type RichTextNodeAttrs = Record<string, unknown>

export const BLOCK_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'image',
  'callout',
  'details',
  'detailsSummary',
  'table',
  'tableCell',
  'tableHeader',
] as const

export interface RichTextNode {
  type: string
  attrs?: RichTextNodeAttrs
  text?: string
  marks?: Array<{ type: string; attrs?: RichTextNodeAttrs }>
  content?: RichTextNode[]
}

export interface RichTextDocument {
  type: 'doc'
  content: RichTextNode[]
}

export type ImageAlignment = 'left' | 'center' | 'right'

export function normalizeImageAlignment(value: unknown): ImageAlignment {
  return value === 'left' || value === 'right' ? value : 'center'
}

export function isEmptyParagraphNode(node: RichTextNode | null | undefined) {
  return node?.type === 'paragraph' && !node.content?.length
}

export function createDiffId(prefix = 'blk') {
  return `${prefix}_${nanoid(10)}`
}

export function createEmptyDocument(): RichTextDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { diffId: createDiffId('p') },
      },
    ],
  }
}

export function cloneRichTextDocument(doc: RichTextDocument): RichTextDocument {
  return JSON.parse(JSON.stringify(doc)) as RichTextDocument
}

export function extractPlainText(node: RichTextNode | RichTextDocument | null | undefined): string {
  if (!node) return ''
  if ('text' in node && typeof node.text === 'string') return node.text
  const content = 'content' in node && Array.isArray(node.content) ? node.content : []
  if (node.type === 'detailsSummary') return content.map(child => extractPlainText(child)).join('')
  if ('type' in node && node.type === 'image') {
    const caption = content.find((child) => child.type === 'imageCaption')
    const captionText = caption ? extractPlainText(caption) : ''
    if (captionText) return captionText
    return typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  }
  if (node.type === 'taskItem') {
    // 标记只进入派生文本；同一段落内的格式边界不插入换行。
    const itemText = (child: RichTextNode): string => {
      if (child.type === 'hardBreak') return '\n'
      if (typeof child.text === 'string') return child.text
      if (['paragraph', 'heading', 'callout', 'codeBlock'].includes(child.type)) return (child.content ?? []).map(itemText).join('')
      return extractPlainText(child)
    }
    return `[${node.attrs?.checked === true ? 'x' : ' '}] ${content.map(itemText).join('\n').trim()}`
  }
  return content.map((child) => extractPlainText(child)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function ensureBlockIds<T extends RichTextDocument>(doc: T): T {
  const seenIds = new Set<string>()

  const visit = (node: RichTextNode) => {
    if (node.type === 'taskItem') node.attrs = { ...node.attrs, checked: node.attrs?.checked ?? false }
    if (node.type === 'image') {
      node.attrs = {
        ...(node.attrs ?? {}),
        align: normalizeImageAlignment(node.attrs?.align),
      }

      if (!node.content?.some((child) => child.type === 'imageCaption')) {
        node.content = [{ type: 'imageCaption' }]
      }
    }

    if (isBlockNode(node)) {
      const diffId = typeof node.attrs?.diffId === 'string' ? node.attrs.diffId : ''
      if (!diffId || seenIds.has(diffId)) {
        node.attrs = { ...(node.attrs ?? {}), diffId: createDiffId(node.type.slice(0, 4) || 'blk') }
      }

      seenIds.add(String(node.attrs?.diffId))
    }

    node.content?.forEach(visit)
  }

  doc.content.forEach(visit)
  return doc
}

export function isBlockNode(node: RichTextNode) {
  return (BLOCK_NODE_TYPES as readonly string[]).includes(node.type)
}
