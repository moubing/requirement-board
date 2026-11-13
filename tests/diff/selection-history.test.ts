import { describe, expect, it } from 'vitest'

import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'
import {
  buildSelectionHistory,
  type SelectionHistoryAnchor,
  type SelectionHistoryVersion,
} from '../../shared/diff/selection-history'

function paragraph(id: string, text: string, marks?: RichTextNode['marks']): RichTextNode {
  return {
    type: 'paragraph',
    attrs: { diffId: id },
    content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : undefined,
  }
}

function image(id: string, src: string, width: number, height: number, caption: string): RichTextNode {
  return {
    type: 'image',
    attrs: { diffId: id, src, width, height, align: 'center' },
    content: [
      {
        type: 'imageCaption',
        content: caption ? [{ type: 'text', text: caption }] : undefined,
      },
    ],
  }
}

function document(...content: RichTextNode[]): RichTextDocument {
  return { type: 'doc', content }
}

function version(
  id: string,
  versionNumber: number | null,
  content: RichTextDocument,
): SelectionHistoryVersion {
  return {
    id,
    label: versionNumber === null ? '当前草稿' : `v${versionNumber}`,
    version: versionNumber,
    document: content,
    draft: versionNumber === null,
  }
}

function anchor(
  blockId: string,
  start: number,
  end: number,
  text: string,
): SelectionHistoryAnchor {
  return {
    text,
    scope: 'selection',
    segments: [{ blockId, blockType: 'paragraph', start, end, text }],
  }
}

describe('selection history', () => {
  it('逐个相邻版本投影范围，并忽略选区之前的修改', () => {
    const result = buildSelectionHistory(anchor('p1', 1, 4, 'abc'), [
      version('draft', null, document(paragraph('p1', 'Xabc'))),
      version('v2', 2, document(paragraph('p1', 'abc'))),
      version('v1', 1, document(paragraph('p1', 'axc'))),
    ])

    expect(result.entries.map((entry) => [entry.id, entry.status])).toEqual([
      ['draft', 'unchanged'],
      ['v2', 'modified'],
      ['v1', 'introduced'],
    ])
    expect(result.entries[1]?.segments[0]?.baseChunks.map((chunk) => [chunk.status, chunk.value])).toEqual([
      ['equal', 'a'],
      ['deleted', 'x'],
      ['equal', 'c'],
    ])
    expect(result.entries[1]?.segments[0]?.targetChunks.map((chunk) => [chunk.status, chunk.value])).toEqual([
      ['equal', 'a'],
      ['inserted', 'b'],
      ['equal', 'c'],
    ])
  })

  it('忽略同一段落中发生在选区之后的修改', () => {
    const result = buildSelectionHistory(anchor('p1', 0, 3, 'abc'), [
      version('draft', null, document(paragraph('p1', 'abc changed'))),
      version('v1', 1, document(paragraph('p1', 'abc original'))),
    ])

    expect(result.entries[0]?.changed).toBe(false)
    expect(result.entries[0]?.segments[0]?.targetChunks).toEqual([
      { status: 'equal', value: 'abc' },
    ])
  })

  it('把选区内的格式变化计入历史', () => {
    const result = buildSelectionHistory(anchor('p1', 0, 3, 'abc'), [
      version('draft', null, document(paragraph('p1', 'abc', [{ type: 'bold' }]))),
      version('v1', 1, document(paragraph('p1', 'abc'))),
    ])

    expect(result.entries[0]?.changed).toBe(true)
    expect(result.entries[0]?.segments[0]?.targetChunks[0]?.formatChange).toEqual({
      before: [],
      after: [{ type: 'bold' }],
    })
  })

  it('分别追踪跨块选区，只报告真正变化的块', () => {
    const selection: SelectionHistoryAnchor = {
      text: 'first\nsecond',
      scope: 'selection',
      segments: [
        { blockId: 'p1', blockType: 'paragraph', start: 0, end: 5, text: 'first' },
        { blockId: 'p2', blockType: 'paragraph', start: 0, end: 6, text: 'second' },
      ],
    }
    const result = buildSelectionHistory(selection, [
      version('draft', null, document(paragraph('p1', 'first'), paragraph('p2', 'second'))),
      version('v1', 1, document(paragraph('p1', 'first'), paragraph('p2', 'SECOND'))),
    ])

    expect(result.entries[0]?.segments.map((segment) => segment.changed)).toEqual([false, true])
    expect(result.entries[0]?.changeCount).toBeGreaterThan(0)
  })

  it('块拆分后可以通过唯一文本回退继续追踪，并标记为推断', () => {
    const result = buildSelectionHistory(anchor('p-new', 0, 6, 'second'), [
      version('draft', null, document(paragraph('p-new', 'second'))),
      version('v1', 1, document(paragraph('p-old', 'first second'))),
    ])

    expect(result.entries[0]?.confidence).toBe('inferred')
    expect(result.entries[0]?.segments[0]?.baseBlockId).toBe('p-old')
    expect(result.entries[0]?.segments[0]?.status).toBe('modified')
  })

  it('无法可靠找到旧块时记录首次出现并停止继续猜测', () => {
    const result = buildSelectionHistory(anchor('p-new', 0, 4, 'beta'), [
      version('draft', null, document(paragraph('p-new', 'beta'))),
      version('v2', 2, document(paragraph('p-old', 'alpha'))),
      version('v1', 1, document(paragraph('p-old', 'older alpha'))),
    ])

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.status).toBe('introduced')
    expect(result.entries[0]?.confidence).toBe('lost')
  })

  it('保留图片两侧节点，供选区历史复用完整 Diff 的图片预览', () => {
    const selection: SelectionHistoryAnchor = {
      text: '架构图',
      scope: 'block',
      segments: [
        {
          blockId: 'image-1',
          blockType: 'image',
          start: 0,
          end: 3,
          text: '架构图',
          wholeBlock: true,
        },
      ],
    }
    const result = buildSelectionHistory(selection, [
      version('draft', null, document(image('image-1', '/new.png', 640, 360, '架构图'))),
      version('v1', 1, document(image('image-1', '/old.png', 480, 270, '架构图'))),
    ])

    const segment = result.entries[0]?.segments[0]
    expect(segment?.changed).toBe(true)
    expect(segment?.baseNode).toMatchObject({
      type: 'image',
      attrs: { src: '/old.png', width: 480, height: 270 },
    })
    expect(segment?.targetNode).toMatchObject({
      type: 'image',
      attrs: { src: '/new.png', width: 640, height: 360 },
    })
    expect(segment?.baseChunks).toEqual([{ status: 'equal', value: '架构图' }])
    expect(segment?.targetChunks).toEqual([{ status: 'equal', value: '架构图' }])
  })
})
