import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { ensureBlockIds, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { createCollaborationDocument, ensureCollaborationTrailingParagraph, readCollaborationDocument } from '../../shared/collaboration/document'
import { applySuggestionOperations } from '../../shared/agent/suggestions'
import { draftDocumentSchema } from '../../shared/drafts/validation'

const paragraph = (text = ''): RichTextNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const blocks: RichTextNode[] = [
  { type: 'image', attrs: { src: '/uploads/test.png' }, content: [{ type: 'imageCaption' }] },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('单元格')] }] }] },
  { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1' }] },
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('列表')] }] },
]
const documentWith = (...content: RichTextNode[]): RichTextDocument => ensureBlockIds({ type: 'doc', content: structuredClone(content) })

describe('与网页一致的必需尾段', () => {
  it.each(blocks)('$type 在写入前只补一个空段落，保留原有块且不修改输入', block => {
    const source = documentWith(block)
    const before = structuredClone(source)
    const normalized = normalizeTrailingParagraph(source)
    expect(source).toEqual(before)
    expect(normalized.content.slice(0, -1)).toEqual(before.content)
    expect(normalized.content.at(-1)).toEqual({ type: 'paragraph', attrs: { diffId: expect.any(String) } })
    expect(draftDocumentSchema.safeParse(normalized).success).toBe(true)
    expect(normalizeTrailingParagraph(normalized)).toBe(normalized)
  })

  it.each([paragraph(), paragraph('普通文字')])('末尾已有普通段落时不再追加', ending => {
    const doc = documentWith(blocks[0]!, ending)
    expect(normalizeTrailingParagraph(doc)).toBe(doc)
  })

  it('旧版本缺尾段的差异、额外空段和实际输入都参与比较', () => {
    const legacy = documentWith(blocks[0]!)
    const normalized = normalizeTrailingParagraph(legacy)
    expect(sameRichTextContent(legacy, normalized)).toBe(false)
    expect(buildRichTextDiff(legacy, normalized).counts).toMatchObject({ inserted: 1, deleted: 0, modified: 0 })
    expect(buildRichTextDiff(normalized, legacy).counts).toMatchObject({ inserted: 0, deleted: 1, modified: 0 })
    const extra = documentWith(...normalized.content, paragraph())
    expect(sameRichTextContent(legacy, extra)).toBe(false)
    expect(buildRichTextDiff(legacy, extra).counts.inserted).toBe(2)
    const text = documentWith(paragraph('正文'))
    expect(sameRichTextContent(text, documentWith(...text.content, paragraph()))).toBe(false)
    const typed = structuredClone(normalized)
    typed.content.at(-1)!.content = [{ type: 'text', text: '继续输入' }]
    expect(sameRichTextContent(legacy, typed)).toBe(false)
    expect(buildRichTextDiff(normalized, typed).counts.modified).toBe(1)
    expect(buildRichTextDiff(legacy, typed).counts.inserted).toBe(1)
  })

  it('AI 删除必需尾段时，在冻结候选前补齐', () => {
    const base = { title: '测试', contentJson: normalizeTrailingParagraph(documentWith(blocks[0]!)) }
    const candidate = applySuggestionOperations(base, [{ op: 'delete_block', targetDiffId: base.contentJson.content.at(-1)!.attrs!.diffId as string }])
    expect(candidate.contentJson.content).toHaveLength(2)
    expect(candidate.contentJson.content.at(-1)!.type).toBe('paragraph')
    expect(sameRichTextContent(base.contentJson, candidate.contentJson)).toBe(true)
  })

  it('共同正文写入沿原 Yjs 历史补齐，重复执行和双副本合并不重复追加', () => {
    const source = documentWith(blocks[0]!)
    const original = createCollaborationDocument({ title: '旧文档', contentJson: source })
    const restored = new Y.Doc(), peer = new Y.Doc()
    try {
      const state = Y.encodeStateAsUpdate(original)
      const clocks = Y.decodeStateVector(Y.encodeStateVector(original))
      Y.applyUpdate(restored, state)
      const kept = restored.getXmlFragment('default').get(0)
      expect(ensureCollaborationTrailingParagraph(restored)).toBe(true)
      expect(restored.getXmlFragment('default').get(0)).toBe(kept)
      for (const [id, clock] of clocks) expect(Y.decodeStateVector(Y.encodeStateVector(restored)).get(id)).toBe(clock)
      const normalized = readCollaborationDocument(restored)
      expect(normalized.contentJson.content.slice(0, -1)).toEqual(readCollaborationDocument(original).contentJson.content)
      expect(ensureCollaborationTrailingParagraph(restored)).toBe(false)
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(restored))
      expect(ensureCollaborationTrailingParagraph(peer)).toBe(false)
      Y.applyUpdate(restored, Y.encodeStateAsUpdate(peer))
      expect(readCollaborationDocument(restored)).toEqual(normalized)
      expect(readCollaborationDocument(original).contentJson.content).toHaveLength(1)
    } finally { original.destroy(); restored.destroy(); peer.destroy() }
  })
})
