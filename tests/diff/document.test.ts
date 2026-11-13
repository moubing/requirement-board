import { describe, expect, it } from 'vitest'

import {
  ensureBlockIds,
  extractPlainText,
  isEmptyParagraphNode,
  type RichTextDocument,
} from '../../shared/editor/document'
import { looksLikeMarkdown } from '../../shared/editor/markdown'
import { parseRichTextDocument } from '../../shared/editor/validation'

describe('editor document ids', () => {
  it('assigns stable ids to legacy horizontal rules', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        { type: 'horizontalRule' },
        { type: 'horizontalRule', attrs: { diffId: 'rule_existing' } },
      ],
    }

    ensureBlockIds(document)

    expect(document.content[0]!.attrs?.diffId).toMatch(/^hori_/)
    expect(document.content[1]!.attrs?.diffId).toBe('rule_existing')
  })

  it('accepts a persisted horizontal rule with a stable id', () => {
    expect(parseRichTextDocument({
      type: 'doc',
      content: [{ type: 'horizontalRule', attrs: { diffId: 'rule_saved' } }],
    })).toEqual({
      type: 'doc',
      content: [{ type: 'horizontalRule', attrs: { diffId: 'rule_saved' } }],
    })
  })

  it('deduplicates copied block ids created by node splitting', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { diffId: 'list_a' },
          content: [
            { type: 'listItem', attrs: { diffId: 'li_a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
            { type: 'listItem', attrs: { diffId: 'li_a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
            { type: 'listItem', attrs: { diffId: 'li_a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'third' }] }] },
          ],
        },
      ],
    }

    ensureBlockIds(document)

    const ids = document.content[0]!.content!.map((node) => node.attrs!.diffId)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('li_a')
  })

  it('assigns a stable id to a pasted table and extracts its cell text', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '分类' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '技术' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '框架' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nuxt' }] }] },
              ],
            },
          ],
        },
      ],
    }

    ensureBlockIds(document)

    expect(document.content[0]!.attrs?.diffId).toMatch(/^tabl_/)
    expect(extractPlainText(document)).toBe('分类\n技术\n框架\nNuxt')
  })

  it('migrates legacy images to an image caption node and extracts caption text', () => {
    const legacyDocument: RichTextDocument = {
      type: 'doc',
      content: [{ type: 'image', attrs: { diffId: 'img_1', src: '/legacy.png', alt: '旧图片' } }],
    }

    ensureBlockIds(legacyDocument)

    expect(legacyDocument.content[0]!.content).toEqual([{ type: 'imageCaption' }])
    expect(legacyDocument.content[0]!.attrs?.align).toBe('center')
    expect(extractPlainText(legacyDocument)).toBe('旧图片')

    legacyDocument.content[0]!.content = [
      { type: 'imageCaption', content: [{ type: 'text', text: '新的图片题注' }] },
    ]
    expect(extractPlainText(legacyDocument)).toBe('新的图片题注')
  })

  it('identifies only structurally empty paragraphs for display hints', () => {
    expect(isEmptyParagraphNode({ type: 'paragraph', attrs: { diffId: 'empty' } })).toBe(true)
    expect(isEmptyParagraphNode({ type: 'paragraph', attrs: { diffId: 'empty_array' }, content: [] })).toBe(true)
    expect(isEmptyParagraphNode({
      type: 'paragraph',
      attrs: { diffId: 'text' },
      content: [{ type: 'text', text: 'hello world' }],
    })).toBe(false)
    expect(isEmptyParagraphNode({
      type: 'paragraph',
      attrs: { diffId: 'hard_break' },
      content: [{ type: 'hardBreak' }],
    })).toBe(false)
    expect(isEmptyParagraphNode({ type: 'heading', attrs: { diffId: 'heading' } })).toBe(false)
  })
})

describe('markdown paste detection', () => {
  it('detects headings, lists and GFM tables', () => {
    expect(looksLikeMarkdown('# 标题\n\n正文')).toBe(true)
    expect(looksLikeMarkdown('- 第一项\n- 第二项')).toBe(true)
    expect(looksLikeMarkdown('| 分类 | 技术 |\n| --- | --- |\n| 框架 | Nuxt |')).toBe(true)
  })

  it('leaves ordinary plain text to the default paste handler', () => {
    expect(looksLikeMarkdown('这是一段普通文本，没有 Markdown 结构。')).toBe(false)
  })
})
