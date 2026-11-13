import { Extension, getSchema, Node } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { z } from 'zod'
import { isCalloutTone } from './callout'
import { CODE_BLOCK_TITLE_MAX_LENGTH, NamedCodeBlock } from './code-block'
import { RequirementTaskItem, RequirementTaskList } from './task-list'
import { RequirementDetails, RequirementDetailsContent, RequirementDetailsSummary } from './details'

import {
  BLOCK_NODE_TYPES,
  normalizeImageAlignment,
  type RichTextDocument,
  type RichTextNode,
} from './document'

const ValidationBlockId = Extension.create({
  name: 'validationBlockId',

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_NODE_TYPES],
        attributes: {
          diffId: { default: null },
        },
      },
    ]
  },
})

const ValidationImageCaption = Node.create({
  name: 'imageCaption',
  content: 'inline*',
  defining: true,
})

const ValidationImage = Image.extend({
  content: 'imageCaption',
  isolating: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: 'center',
      },
    }
  },
})

const ValidationCallout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      diffId: { default: null },
      tone: { default: 'note' },
    }
  },
})

export const richTextProseMirrorSchema = getSchema([
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    codeBlock: false,
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    defaultProtocol: 'https',
  }),
  ValidationImage,
  ValidationImageCaption,
  Highlight,
  TableKit,
  ValidationBlockId,
  ValidationCallout,
  NamedCodeBlock,
  RequirementTaskList,
  RequirementTaskItem,
  RequirementDetails,
  RequirementDetailsSummary,
  RequirementDetailsContent,
])

const attrsSchema = z.record(z.string(), z.unknown())

const markJsonSchema = z
  .object({
    type: z.string().min(1),
    attrs: attrsSchema.optional(),
  })
  .strict()

export const nodeJsonSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      attrs: attrsSchema.optional(),
      text: z.string().optional(),
      marks: z.array(markJsonSchema).optional(),
      content: z.array(nodeJsonSchema).optional(),
    })
    .strict(),
)

const documentJsonSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(nodeJsonSchema),
  })
  .strict()

function assertKnownAttributes(node: RichTextNode, path = 'doc') {
  const nodeType = richTextProseMirrorSchema.nodes[node.type]
  if (!nodeType) throw new Error(`Unknown Tiptap node "${node.type}" at ${path}`)

  for (const attr of Object.keys(node.attrs ?? {})) {
    if (!(attr in (nodeType.spec.attrs ?? {}))) {
      throw new Error(`Unknown attribute "${attr}" on node "${node.type}" at ${path}`)
    }
  }

  for (const [index, mark] of (node.marks ?? []).entries()) {
    const markType = richTextProseMirrorSchema.marks[mark.type]
    if (!markType) throw new Error(`Unknown Tiptap mark "${mark.type}" at ${path}.marks[${index}]`)

    for (const attr of Object.keys(mark.attrs ?? {})) {
      if (!(attr in (markType.spec.attrs ?? {}))) {
        throw new Error(`Unknown attribute "${attr}" on mark "${mark.type}" at ${path}.marks[${index}]`)
      }
    }
  }

  if (node.type === 'image') assertImageAttributes(node, path)
  if (node.type === 'taskItem' && node.attrs?.checked !== undefined && typeof node.attrs.checked !== 'boolean') {
    throw new Error(`Task item checked must be a boolean at ${path}`)
  }
  if (node.type === 'codeBlock' && node.attrs?.title != null) {
    const title = node.attrs.title
    if (typeof title !== 'string' || title.length > CODE_BLOCK_TITLE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error(`Code block title must be a single-line string of at most ${CODE_BLOCK_TITLE_MAX_LENGTH} characters at ${path}`)
    }
  }
  if (node.type === 'callout' && node.attrs?.tone !== undefined && !isCalloutTone(node.attrs.tone)) {
    throw new Error(`Callout tone must be note, tip, warning, or danger at ${path}`)
  }
  if (node.type === 'heading' && ![1, 2, 3].includes(Number(node.attrs?.level))) {
    throw new Error(`Heading level must be 1, 2, or 3 at ${path}`)
  }

  node.content?.forEach((child, index) => assertKnownAttributes(child, `${path}.content[${index}]`))
}

function assertImageAttributes(node: RichTextNode, path: string) {
  if (typeof node.attrs?.src !== 'string' || !node.attrs.src.trim()) {
    throw new Error(`Image src must be a non-empty string at ${path}`)
  }

  if (node.attrs.src.startsWith('data:')) {
    throw new Error(`Base64 image sources are not allowed at ${path}`)
  }

  if (normalizeImageAlignment(node.attrs.align) !== node.attrs.align) {
    throw new Error(`Image align must be left, center, or right at ${path}`)
  }

  for (const dimension of ['width', 'height'] as const) {
    const value = node.attrs[dimension]
    if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Image ${dimension} must be a positive number at ${path}`)
    }
  }
}

function validateWithProseMirror(document: RichTextDocument) {
  for (const [index, node] of document.content.entries()) {
    assertKnownAttributes(node, `doc.content[${index}]`)
  }

  const proseMirrorNode = richTextProseMirrorSchema.nodeFromJSON(document)
  proseMirrorNode.check()
  return document
}

export const richTextDocumentSchema = documentJsonSchema.transform((document, context) => {
  try {
    return validateWithProseMirror(document)
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid Tiptap document',
    })
    return z.NEVER
  }
})

export function parseRichTextDocument(value: unknown): RichTextDocument {
  return richTextDocumentSchema.parse(value)
}
