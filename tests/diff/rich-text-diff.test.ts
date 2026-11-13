import { describe, expect, it } from 'vitest'

import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import type { RichTextDocument } from '../../shared/editor/document'

function doc(content: RichTextDocument['content']): RichTextDocument {
  return { type: 'doc', content }
}

describe('rich text diff', () => {
  it('忽略空属性但保留容器内节点的类型与图片属性变化', () => {
    expect(buildRichTextDiff(doc([{ type: 'paragraph', attrs: { diffId: 'a' } }]), doc([{ type: 'paragraph', attrs: { diffId: 'a', unused: null } }])).counts.modified).toBe(0)
    const wrap = (type: string) => doc([{ type: 'blockquote', attrs: { diffId: 'quote' }, content: [{ type, attrs: { diffId: 'nested' }, content: [{ type: 'text', text: '相同文字' }] }] }])
    expect(buildRichTextDiff(wrap('paragraph'), wrap('heading')).counts.modified).toBe(1)
    const image = (src: string) => doc([{ type: 'blockquote', attrs: { diffId: 'quote' }, content: [{ type: 'image', attrs: { diffId: 'img', src }, content: [{ type: 'imageCaption' }] }] }])
    expect(buildRichTextDiff(image('/uploads/old.png'), image('/uploads/new.png')).counts.modified).toBe(1)
  })
  it('matches blocks by diffId and highlights inline text changes', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'a' },
          content: [{ type: 'text', text: '先做编辑器' }],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'a' },
          content: [{ type: 'text', text: '先做富文本编辑器' }],
        },
      ]),
    )

    expect(result.counts.modified).toBe(1)
    expect(result.pairs[0].targetChunks.some((chunk) => chunk.status === 'inserted')).toBe(true)
  })

  it('highlights inserted characters inside a word without replacing the whole word', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'a' },
          content: [{ type: 'text', text: 'dfsdfsdfsfds' }],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'a' },
          content: [{ type: 'text', text: 'dfsdfsdf***sfds' }],
        },
      ]),
    )

    expect(result.pairs[0].baseChunks).toEqual([{ status: 'equal', value: 'dfsdfsdfsfds' }])
    expect(result.pairs[0].targetChunks).toEqual([
      { status: 'equal', value: 'dfsdfsdf' },
      { status: 'inserted', value: '***' },
      { status: 'equal', value: 'sfds' },
    ])
  })

  it('keeps Shift+Enter hard breaks as inline diff tokens', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'hard_break_a' },
          content: [{ type: 'text', text: '第一行第二行' }],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'hard_break_a' },
          content: [
            { type: 'text', text: '第一行' },
            { type: 'hardBreak' },
            { type: 'text', text: '第二行' },
          ],
        },
      ]),
    )

    expect(result.pairs[0].status).toBe('modified')
    expect(result.pairs[0].baseChunks).toEqual([{ status: 'equal', value: '第一行第二行' }])
    expect(result.pairs[0].targetChunks).toEqual([
      { status: 'equal', value: '第一行' },
      { status: 'inserted', value: '\n' },
      { status: 'equal', value: '第二行' },
    ])
  })

  it('does not trim intentional hard breaks at a paragraph boundary', () => {
    const content = [
      { type: 'hardBreak' },
      { type: 'text', text: '正文' },
      { type: 'hardBreak' },
    ]
    const result = buildRichTextDiff(
      doc([{ type: 'paragraph', attrs: { diffId: 'edge_breaks' }, content }]),
      doc([{ type: 'paragraph', attrs: { diffId: 'edge_breaks' }, content }]),
    )

    expect(result.pairs[0].status).toBe('unchanged')
    expect(result.pairs[0].targetChunks).toEqual([{ status: 'equal', value: '\n正文\n' }])
  })

  it('detects formatting-only changes and keeps each side rich-text marks', () => {
    const text = '对比不同版本的内容变化'
    const result = buildRichTextDiff(
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'format_a' },
          content: [{ type: 'text', text }],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'format_a' },
          content: [
            { type: 'text', text: '对比' },
            {
              type: 'text',
              text: '不同版本',
              marks: [{ type: 'italic' }, { type: 'highlight' }],
            },
            { type: 'text', text: '的内容变化' },
          ],
        },
      ]),
    )

    expect(result.counts.modified).toBe(1)
    expect(result.counts.unchanged).toBe(0)

    const pair = result.pairs[0]!
    const baseChanged = pair.baseChunks.find((chunk) => chunk.formatChange)
    const targetChanged = pair.targetChunks.find((chunk) => chunk.formatChange)

    expect(baseChanged).toMatchObject({
      status: 'equal',
      value: '不同版本',
      formatChange: {
        before: [],
        after: [{ type: 'highlight' }, { type: 'italic' }],
      },
    })
    expect(baseChanged?.marks).toBeUndefined()
    expect(targetChanged).toMatchObject({
      status: 'equal',
      value: '不同版本',
      marks: [{ type: 'highlight' }, { type: 'italic' }],
    })
    expect(pair.baseChunks.some((chunk) => chunk.status === 'deleted')).toBe(false)
    expect(pair.targetChunks.some((chunk) => chunk.status === 'inserted')).toBe(false)
  })

  it('detects link destination changes but ignores mark order and non-semantic link defaults', () => {
    const richText = (
      marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
    ): RichTextDocument => doc([
      {
        type: 'paragraph',
        attrs: { diffId: 'link_a' },
        content: [{ type: 'text', text: '查看需求', marks }],
      },
    ])

    const sameLink = buildRichTextDiff(
      richText([
        { type: 'italic' },
        { type: 'bold' },
        { type: 'link', attrs: { href: 'https://example.com/a', rel: 'noopener noreferrer' } },
      ]),
      richText([
        { type: 'link', attrs: { href: 'https://example.com/a', rel: 'different-default' } },
        { type: 'bold' },
        { type: 'italic' },
      ]),
    )

    expect(sameLink.pairs[0]!.status).toBe('unchanged')

    const changedLink = buildRichTextDiff(
      richText([{ type: 'link', attrs: { href: 'https://example.com/a' } }]),
      richText([{ type: 'link', attrs: { href: 'https://example.com/b' } }]),
    )

    expect(changedLink.pairs[0]!.status).toBe('modified')
    expect(changedLink.pairs[0]!.targetChunks).toEqual([
      {
        status: 'equal',
        value: '查看需求',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/b' } }],
        formatChange: {
          before: [{ type: 'link', attrs: { href: 'https://example.com/a' } }],
          after: [{ type: 'link', attrs: { href: 'https://example.com/b' } }],
        },
      },
    ])
  })

  it('combines text insertion and formatting changes without treating equal text as replaced', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'mixed_a' },
          content: [{ type: 'text', text: '搜索和筛选需求' }],
        },
      ]),
      doc([
        {
          type: 'paragraph',
          attrs: { diffId: 'mixed_a' },
          content: [
            { type: 'text', text: '快速' },
            { type: 'text', text: '搜索和筛选需求', marks: [{ type: 'highlight' }] },
          ],
        },
      ]),
    )

    expect(result.pairs[0]!.status).toBe('modified')
    expect(result.pairs[0]!.targetChunks).toEqual([
      { status: 'inserted', value: '快速' },
      {
        status: 'equal',
        value: '搜索和筛选需求',
        marks: [{ type: 'highlight' }],
        formatChange: {
          before: [],
          after: [{ type: 'highlight' }],
        },
      },
    ])
  })

  it('aligns list items by diffId even when the editor splits a list node', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'bulletList',
          attrs: { diffId: 'list_a' },
          content: [
            { type: 'listItem', attrs: { diffId: 'li_1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
            { type: 'listItem', attrs: { diffId: 'li_2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
            { type: 'listItem', attrs: { diffId: 'li_3' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dfjdsl' }] }] },
          ],
        },
      ]),
      doc([
        {
          type: 'bulletList',
          attrs: { diffId: 'list_a' },
          content: [
            { type: 'listItem', attrs: { diffId: 'li_1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
            { type: 'listItem', attrs: { diffId: 'li_2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
          ],
        },
        {
          type: 'bulletList',
          attrs: { diffId: 'list_b' },
          content: [
            { type: 'listItem', attrs: { diffId: 'li_3' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '***dfjdsl' }] }] },
          ],
        },
      ]),
    )

    expect(result.counts.inserted).toBe(0)
    expect(result.counts.deleted).toBe(0)
    expect(result.counts.modified).toBe(1)
    expect(result.pairs.map((pair) => pair.id)).toEqual(['li_1', 'li_2', 'li_3'])
    expect(result.pairs[2].targetChunks).toEqual([
      { status: 'inserted', value: '***' },
      { status: 'equal', value: 'dfjdsl' },
    ])
  })

  it('detects inserted and deleted blocks', () => {
    const result = buildRichTextDiff(
      doc([
        { type: 'paragraph', attrs: { diffId: 'a' }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', attrs: { diffId: 'b' }, content: [{ type: 'text', text: 'B' }] },
      ]),
      doc([
        { type: 'paragraph', attrs: { diffId: 'b' }, content: [{ type: 'text', text: 'B' }] },
        { type: 'paragraph', attrs: { diffId: 'c' }, content: [{ type: 'text', text: 'C' }] },
      ]),
    )

    expect(result.counts.deleted).toBe(1)
    expect(result.counts.inserted).toBe(1)
    expect(result.counts.unchanged).toBe(1)
  })

  it('keeps an empty paragraph as a real inserted diff block', () => {
    const result = buildRichTextDiff(
      doc([
        { type: 'paragraph', attrs: { diffId: 'a' }, content: [{ type: 'text', text: 'hello world' }] },
      ]),
      doc([
        { type: 'paragraph', attrs: { diffId: 'a' }, content: [{ type: 'text', text: 'hello world' }] },
        { type: 'paragraph', attrs: { diffId: 'empty' } },
      ]),
    )

    expect(result.counts.inserted).toBe(1)
    expect(result.pairs[1]).toMatchObject({
      id: 'empty',
      status: 'inserted',
      base: null,
      target: {
        type: 'paragraph',
        text: '',
        inlineTokens: [],
        node: { type: 'paragraph', attrs: { diffId: 'empty' } },
      },
      targetChunks: [],
    })
  })

  it('keeps a horizontal rule aligned by its stable id', () => {
    const result = buildRichTextDiff(
      doc([
        { type: 'horizontalRule', attrs: { diffId: 'rule_a' } },
        { type: 'paragraph', attrs: { diffId: 'after' }, content: [{ type: 'text', text: 'after' }] },
      ]),
      doc([
        { type: 'paragraph', attrs: { diffId: 'before' }, content: [{ type: 'text', text: 'before' }] },
        { type: 'horizontalRule', attrs: { diffId: 'rule_a' } },
        { type: 'paragraph', attrs: { diffId: 'after' }, content: [{ type: 'text', text: 'after' }] },
      ]),
    )

    expect(result.pairs.map((pair) => [pair.id, pair.status])).toEqual([
      ['before', 'inserted'],
      ['rule_a', 'unchanged'],
      ['after', 'unchanged'],
    ])
  })

  it('detects image attr changes and diffs caption text independently', () => {
    const result = buildRichTextDiff(
      doc([
        {
          type: 'image',
          attrs: { diffId: 'img', src: '/a.png', alt: '架构图', width: 480, height: 270 },
          content: [{ type: 'imageCaption', content: [{ type: 'text', text: '系统架构图' }] }],
        },
      ]),
      doc([
        {
          type: 'image',
          attrs: { diffId: 'img', src: '/b.png', alt: '架构图', width: 640, height: 360 },
          content: [{ type: 'imageCaption', content: [{ type: 'text', text: '新版系统架构图' }] }],
        },
      ]),
    )

    expect(result.pairs[0].status).toBe('modified')
    expect(result.pairs[0].baseChunks).toEqual([{ status: 'equal', value: '系统架构图' }])
    expect(result.pairs[0].targetChunks).toEqual([
      { status: 'inserted', value: '新版' },
      { status: 'equal', value: '系统架构图' },
    ])
  })

  it('normalizes legacy image alignment and detects alignment changes', () => {
    const image = (align?: 'left' | 'center' | 'right') => ({
      type: 'image',
      attrs: { diffId: 'img', src: '/architecture.png', ...(align ? { align } : {}) },
      content: [{ type: 'imageCaption', content: [{ type: 'text', text: '系统架构图' }] }],
    })

    expect(buildRichTextDiff(doc([image()]), doc([image('center')])).pairs[0].status).toBe('unchanged')
    expect(buildRichTextDiff(doc([image('left')]), doc([image('right')])).pairs[0].status).toBe('modified')
  })

  it('diffs changed table headers without marking unchanged body cells', () => {
    const table = (firstHeader: string, secondHeader: string) => ({
      type: 'table',
      attrs: { diffId: 'table_1' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: firstHeader }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: secondHeader }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '前端框架' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nuxt 4、Vue 3' }] }],
            },
          ],
        },
      ],
    })

    const result = buildRichTextDiff(doc([table('分类', '技术')]), doc([table('dfsdf分类', '技术dfsdfds')]))
    const tableDiff = result.pairs[0]!.table!

    expect(result.counts.modified).toBe(1)
    expect(result.pairs[0].id).toBe('table_1')
    expect(tableDiff.changed).toBe(true)
    expect(tableDiff.rows[0]!.cells[0]!.status).toBe('modified')
    expect(tableDiff.rows[0]!.cells[0]!.targetChunks).toEqual([
      { status: 'inserted', value: 'dfsdf' },
      { status: 'equal', value: '分类' },
    ])
    expect(tableDiff.rows[0]!.cells[1]!.targetChunks).toEqual([
      { status: 'equal', value: '技术' },
      { status: 'inserted', value: 'dfsdfds' },
    ])
    expect(tableDiff.rows[1]!.cells.map((cell) => cell.status)).toEqual(['unchanged', 'unchanged'])
    expect(tableDiff.rows[1]!.cells[0]!.targetChunks).toEqual([{ status: 'equal', value: '前端框架' }])
  })

  it('detects formatting-only changes inside table cells', () => {
    const table = (marks?: Array<{ type: string }>) => ({
      type: 'table',
      attrs: { diffId: 'table_format' },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'PostgreSQL', ...(marks ? { marks } : {}) }],
                },
              ],
            },
          ],
        },
      ],
    })

    const result = buildRichTextDiff(
      doc([table()]),
      doc([table([{ type: 'bold' }, { type: 'highlight' }])]),
    )
    const cell = result.pairs[0]!.table!.rows[0]!.cells[0]!

    expect(result.pairs[0]!.status).toBe('modified')
    expect(cell.status).toBe('modified')
    expect(cell.targetChunks).toEqual([
      {
        status: 'equal',
        value: 'PostgreSQL',
        marks: [{ type: 'bold' }, { type: 'highlight' }],
        formatChange: {
          before: [],
          after: [{ type: 'bold' }, { type: 'highlight' }],
        },
      },
    ])
  })
})
