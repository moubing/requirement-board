import { describe, expect, it } from 'vitest'

import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'
import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'

function doc(content: RichTextDocument['content']): RichTextDocument {
  return { type: 'doc', content }
}

function bulletList(items: RichTextNode[]): RichTextNode {
  return {
    type: 'bulletList',
    attrs: { diffId: 'list_a' },
    content: items,
  }
}

function listItem(id: string, text: string): RichTextNode {
  return {
    type: 'listItem',
    attrs: { diffId: id },
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function listTexts(document: RichTextDocument) {
  const list = document.content.find((node) => node.type === 'bulletList' || node.type === 'orderedList')
  return (list?.content ?? []).map((item) => nodeText(item))
}

function nodeText(node: RichTextNode): string {
  if (typeof node.text === 'string') return node.text
  return (node.content ?? []).map((child) => nodeText(child)).join('')
}

describe('revert draft change', () => {
  it('reverts modified list items by nested diffId', () => {
    const base = doc([bulletList([listItem('li_1', 'first'), listItem('li_2', 'second'), listItem('li_3', 'third')])])
    const draft = doc([bulletList([listItem('li_1', 'first333'), listItem('li_2', 'second'), listItem('li_3', 'third')])])
    const pair = buildRichTextDiff(base, draft).pairs.find((item) => item.id === 'li_1')

    expect(pair?.status).toBe('modified')
    const result = revertDraftChange(draft, base, { status: 'modified', pairs: [pair!] })

    expect(result.changed).toBe(true)
    expect(listTexts(result.document)).toEqual(['first', 'second', 'third'])
  })

  it('reports no change when a modified list item is already reverted', () => {
    const base = doc([bulletList([listItem('li_1', 'first')])])
    const draft = doc([bulletList([listItem('li_1', 'first333')])])
    const pair = buildRichTextDiff(base, draft).pairs.find((item) => item.id === 'li_1')
    const firstResult = revertDraftChange(draft, base, { status: 'modified', pairs: [pair!] })
    const secondResult = revertDraftChange(firstResult.document, base, { status: 'modified', pairs: [pair!] })

    expect(firstResult.changed).toBe(true)
    expect(secondResult.changed).toBe(false)
    expect(listTexts(secondResult.document)).toEqual(['first'])
  })

  it('removes inserted list items from the draft', () => {
    const base = doc([bulletList([listItem('li_1', 'first'), listItem('li_3', 'third')])])
    const draft = doc([bulletList([listItem('li_1', 'first'), listItem('li_2', 'second'), listItem('li_3', 'third')])])
    const pair = buildRichTextDiff(base, draft).pairs.find((item) => item.id === 'li_2')

    expect(pair?.status).toBe('inserted')
    const result = revertDraftChange(draft, base, { status: 'inserted', pairs: [pair!] })

    expect(result.changed).toBe(true)
    expect(listTexts(result.document)).toEqual(['first', 'third'])
  })

  it('restores deleted list items to their original position', () => {
    const base = doc([bulletList([listItem('li_1', 'first'), listItem('li_2', 'second'), listItem('li_3', 'third')])])
    const draft = doc([bulletList([listItem('li_1', 'first'), listItem('li_3', 'third')])])
    const pair = buildRichTextDiff(base, draft).pairs.find((item) => item.id === 'li_2')

    expect(pair?.status).toBe('deleted')
    const result = revertDraftChange(draft, base, { status: 'deleted', pairs: [pair!] })

    expect(result.changed).toBe(true)
    expect(listTexts(result.document)).toEqual(['first', 'second', 'third'])
  })

  it('reverts formatting-only changes with the existing modified-block flow', () => {
    const base = doc([
      {
        type: 'paragraph',
        attrs: { diffId: 'format_a' },
        content: [{ type: 'text', text: '格式变化' }],
      },
    ])
    const draft = doc([
      {
        type: 'paragraph',
        attrs: { diffId: 'format_a' },
        content: [{ type: 'text', text: '格式变化', marks: [{ type: 'italic' }, { type: 'highlight' }] }],
      },
    ])
    const pair = buildRichTextDiff(base, draft).pairs[0]!

    expect(pair.status).toBe('modified')
    const result = revertDraftChange(draft, base, { status: 'modified', pairs: [pair] })

    expect(result.changed).toBe(true)
    expect(result.document).toEqual(base)
  })
})
