import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { ensureBlockIds, type RichTextDocument } from '../../shared/editor/document'

describe('markdown parser', () => {
  it('converts headings, lists and GFM tables to Tiptap JSON', () => {
    const manager = new MarkdownManager({
      extensions: [StarterKit, Image, TableKit, Markdown.configure({ markedOptions: { gfm: true } })],
    })

    const document = manager.parse(`
# 标题

- 第一项
- 第二项

| 分类 | 技术 |
| --- | --- |
| 框架 | Nuxt |

![架构图](https://example.com/architecture.png)
`)
    ensureBlockIds(document as RichTextDocument)

    expect(document.content?.map((node) => node.type)).toEqual(['heading', 'bulletList', 'table', 'image'])
    expect(document.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(document.content?.[1]?.content).toHaveLength(2)
    expect(document.content?.[2]?.content?.[0]?.content?.map((cell) => cell.type)).toEqual([
      'tableHeader',
      'tableHeader',
    ])
    expect(document.content?.[3]).toMatchObject({
      type: 'image',
      attrs: { src: 'https://example.com/architecture.png', alt: '架构图' },
      content: [{ type: 'imageCaption' }],
    })
  })
})
