import { describe, expect, it } from 'vitest'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { buildVersionMarkers } from '../../shared/diff/version-markers'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'
import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'

const p = (id: string, text = id): RichTextNode => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content })
const markers = (base: RichTextDocument, target: RichTextDocument) => buildVersionMarkers(buildRichTextDiff(base, target).pairs)

describe('正文版本标记映射', () => {
  it('复用块状态，连续删除合并且前后锚点指向当前正文', () => {
    const result = markers(doc(p('a'), p('b'), p('c'), p('d')), doc(p('a', '改了'), p('d'), p('new')))
    expect(result.map(({ status, targetId, beforeId, afterId, pairs }) => ({ status, targetId, beforeId, afterId, count: pairs.length }))).toEqual([
      { status: 'modified', targetId: 'a', beforeId: null, afterId: null, count: 1 },
      { status: 'deleted', targetId: null, beforeId: 'a', afterId: 'd', count: 2 },
      { status: 'inserted', targetId: 'new', beforeId: 'd', afterId: null, count: 1 },
    ])
  })
  it('覆盖文首、文末、全删及两段互不连续删除', () => {
    expect(markers(doc(p('a'), p('b')), doc(p('b')))[0]).toMatchObject({ beforeId: null, afterId: 'b' })
    expect(markers(doc(p('a'), p('b')), doc(p('a')))[0]).toMatchObject({ beforeId: 'a', afterId: null })
    expect(markers(doc(p('a'), p('b')), doc())[0]).toMatchObject({ beforeId: null, afterId: null, pairs: expect.any(Array) })
    expect(markers(doc(p('a'), p('b'), p('c')), doc(p('b')))).toHaveLength(2)
    expect(markers(doc(p('a')), doc(p('a')))).toEqual([])
  })
  it('列表按直接 listItem，图片和表格各自保持一个标记', () => {
    const list = (items: string[]): RichTextNode => ({ type: 'bulletList', attrs: { diffId: 'list' }, content: items.map(id => ({ type: 'listItem', attrs: { diffId: id }, content: [p(`${id}-p`)] })) })
    const base = doc(list(['li-a', 'li-b']), p('tail'))
    const target = doc(list(['li-a', 'li-c']), { type: 'table', attrs: { diffId: 'table' }, content: [] },
      { type: 'image', attrs: { diffId: 'image', src: '/uploads/test.png' }, content: [{ type: 'imageCaption' }] }, p('tail'))
    expect(markers(base, target).map(item => item.targetId ?? item.pairs[0]!.base!.id)).toContain('li-c')
    expect(markers(base, target).map(item => item.targetId)).toEqual(expect.arrayContaining(['table', 'image']))
    const deleted = markers(base, doc(p('tail')))[0]!
    expect(deleted.pairs).toHaveLength(2)
    expect(revertDraftChange(doc(p('tail')), base, deleted).document).toEqual(base)
    expect(base.content[0]!.content).toHaveLength(2)
  })
  it('列表起号或类型变化也标记，并恢复共享容器而不丢失其他列表项', () => {
    const item: RichTextNode = { type: 'listItem', attrs: { diffId: 'li' }, content: [p('text')] }
    const base = doc({ type: 'orderedList', attrs: { diffId: 'list', start: 3 }, content: [item] }, p('tail'))
    for (const [type, start] of [['orderedList', 7], ['bulletList', undefined]] as const) {
      const target = doc({ type, attrs: { diffId: 'current-list', start }, content: [structuredClone(item), { type: 'listItem', attrs: { diffId: 'extra' }, content: [p('extra-text')] }] }, p('tail'))
      const marker = markers(base, target).find(marker => marker.targetId === 'li')!
      expect(marker.status).toBe('modified')
      const restored = revertDraftChange(target, base, marker)
      expect(restored.changed).toBe(true)
      expect(restored.document.content[0]).toMatchObject({ type: 'orderedList', attrs: { diffId: 'current-list', start: 3 } })
      expect(restored.document.content[0]!.content).toHaveLength(2)
      expect(markers(base, restored.document).map(marker => marker.status)).toEqual(['inserted'])
    }
  })
})
