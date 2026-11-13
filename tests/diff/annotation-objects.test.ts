import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap'
import { anchorSegment, extractAnnotationBlocks, captureObjectTarget, resolveAnnotation, resolveAnnotationRequest, annotationFingerprint, ANNOTATION_FORMAT, ANNOTATION_REQUIREMENTS, formatAnnotationRequest, parseAnnotationRequest, type AiAnnotation, type AnnotationRequest } from '../../shared/agent/annotations'
import { sha256 } from '../../skills/requirement-board/scripts/annotation-objects.mjs'
import { ensureBlockIds, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { richTextProseMirrorSchema } from '../../shared/editor/validation'
import { readCollaborationDocument } from '../../shared/collaboration/document'
import { upgradeCollaborativeCellIds } from '../../shared/collaboration/cell-identity'
import { sameVersionContent } from '../../shared/editor/content-equality'
import { applySuggestionOperations } from '../../shared/agent/suggestions'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'

const paragraph = (text = ''): RichTextNode => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })
const image = (id: string): RichTextNode => ({ type: 'image', attrs: { diffId: id, src: '/uploads/asset_abcdefghijkl.png', alt: '', align: 'center' }, content: [{ type: 'imageCaption' }] })
function fixture() {
  return ensureBlockIds<RichTextDocument>({ type: 'doc', content: [image('image1'), image('image2'), { type: 'table', attrs: { diffId: 'table' }, content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { diffId: 'header', rowspan: 2, colspan: 2 }, content: [paragraph('相同😀')] }, { type: 'tableCell', attrs: { diffId: 'cell' }, content: [paragraph('相同😀'), paragraph('第二段')] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', attrs: { diffId: 'empty' }, content: [paragraph()] }] },
  ] }, paragraph()] })
}
function note(doc: RichTextDocument, type: 'image' | 'table' | 'cell', id: string): AiAnnotation {
  const target = captureObjectTarget(doc, type, id)
  return { id: `note-${id}`, target, quote: target.summary, comment: '修改要求', section: '', segments: [] }
}
const cell = (doc: RichTextDocument, row = 0, column = 1) => doc.content[2]!.content![row]!.content![column]!

describe('图片、整表和单元格标注', () => {
  it('同步 SHA-256 与 Web Crypto/Node 标准结果一致', () => {
    for (const input of ['', 'abc', '中文😀\n'.repeat(1000)]) expect(sha256(input)).toBe(createHash('sha256').update(input).digest('hex'))
  })
  it('同资源图片、相同文字及空格单元格按独立身份定位，合并网格准确', () => {
    const doc = fixture()
    expect(captureObjectTarget(doc, 'cell', 'empty')).toMatchObject({ tableId: 'table', range: { row: 2, column: 3, rowspan: 1, colspan: 1 }, summary: '' })
    expect(captureObjectTarget(doc, 'cell', 'header')).toMatchObject({ range: { row: 1, column: 1, rowspan: 2, colspan: 2 } })
    const selected = note(doc, 'image', 'image2')
    doc.content.splice(1, 1)
    expect(resolveAnnotation(selected, doc).status).toBe('unresolved')
    expect(resolveAnnotation(note(fixture(), 'image', 'image1'), doc).status).toBe('exact')
  })
  it('尺寸、图片对齐和列宽保持有效，文字、marks、题注和资源变化严格失效', () => {
    const doc = fixture(), notes = [note(doc, 'image', 'image1'), note(doc, 'table', 'table'), note(doc, 'cell', 'cell')]
    Object.assign(doc.content[0]!.attrs!, { width: 500, height: 300, align: 'right' })
    cell(doc).attrs!.colwidth = [120]
    expect(notes.map(value => resolveAnnotation(value, doc).status)).toEqual(['exact', 'exact', 'exact'])
    cell(doc).content![0]!.content![0]!.marks = [{ type: 'bold' }]
    expect(notes.map(value => resolveAnnotation(value, doc).status)).toEqual(['exact', 'unresolved', 'unresolved'])
    doc.content[0]!.content![0]!.content = [{ type: 'text', text: '新题注' }]
    expect(resolveAnnotation(notes[0]!, doc).status).toBe('unresolved')
    for (const key of ['src', 'alt', 'title']) {
      const next = fixture(); next.content[0]!.attrs![key] = 'changed'
      expect(resolveAnnotation(notes[0]!, next).status).toBe('unresolved')
    }
  })
  it('目标外增删行列和其他内容不转移目标；跨表、缺失 ID、跨度和类型变化失效', () => {
    const doc = fixture(), selected = note(doc, 'cell', 'cell')
    doc.content[2]!.content!.unshift({ type: 'tableRow', content: Array.from({ length: 3 }, () => ({ type: 'tableCell', content: [paragraph('新增')] })) })
    ensureBlockIds(doc)
    expect(resolveAnnotation(selected, doc)).toMatchObject({ status: 'moved', target: { range: { row: 2, column: 3 } } })
    for (const mutate of [
      (next: RichTextDocument) => { next.content[2]!.attrs!.diffId = 'another-table' },
      (next: RichTextDocument) => { cell(next).attrs!.colspan = 2 },
      (next: RichTextDocument) => { cell(next).type = 'tableHeader' },
      (next: RichTextDocument) => { delete cell(next).attrs!.diffId },
    ]) { const next = fixture(); mutate(next); expect(resolveAnnotation(selected, next).status).toBe('unresolved') }
  })
  it('混合 v2 的摘要完整绑定复制依据及要求，不携带完整表格；v1 重新核验新版快照', async () => {
    const doc = fixture(), selected = note(doc, 'cell', 'cell')
    const payload: AnnotationRequest = { format: ANNOTATION_FORMAT, requirements: ANNOTATION_REQUIREMENTS, source: 'shared-draft', contentToken: `3:${'a'.repeat(64)}`,
      createdAt: new Date().toISOString(), overall: '整体要求', document: { id: 'req_test', key: 'REQ-1', title: '', origin: 'https://board.example', url: 'https://board.example/requirements/req_test' },
      annotations: [note(doc, 'image', 'image1'), note(doc, 'table', 'table'), selected] }
    const encoded = formatAnnotationRequest(payload)
    expect(encoded).not.toContain('contentJson')
    expect(parseAnnotationRequest(encoded)).toEqual(payload)
    const snapshot = { id: 'req_test', schemaVersion: 3, contentToken: payload.contentToken, contentJson: doc }
    expect(resolveAnnotationRequest(payload, snapshot, payload.document.origin)).toMatchObject({ ready: true, topLevelIds: ['image1', 'table'] })
    const fingerprint = await annotationFingerprint(selected, payload.overall)
    expect(await annotationFingerprint({ ...selected, comment: '变更' }, payload.overall)).not.toBe(fingerprint)
    const changed = structuredClone(selected); if (changed.target?.type === 'cell') changed.target.range.row++
    expect(await annotationFingerprint(changed, payload.overall)).not.toBe(fingerprint)
    expect(await annotationFingerprint(selected, '改变整体要求')).not.toBe(fingerprint)
    expect(() => resolveAnnotationRequest(payload, { ...snapshot, schemaVersion: 2 }, payload.document.origin)).toThrow('schema 3')
    expect(() => formatAnnotationRequest({ ...payload, annotations: Array.from({ length: 31 }, (_, i) => ({ ...selected, id: String(i) })) })).toThrow('30')
    const textDoc = ensureBlockIds<RichTextDocument>({ type: 'doc', content: [paragraph('旧版文字')] })
    const legacy: AiAnnotation = { id: 'legacy', comment: '旧要求', quote: '旧版', section: '', segments: [anchorSegment(extractAnnotationBlocks(textDoc)[0]!, 0, 2)] }
    const oldRequest: AnnotationRequest = { ...payload, format: 'rb-annotations/v1', contentToken: `2:${'b'.repeat(64)}`, annotations: [legacy] }
    delete oldRequest.requirements
    expect(resolveAnnotationRequest(oldRequest, { ...snapshot, contentJson: textDoc }, payload.document.origin).ready).toBe(true)
    const value = [legacy.id, legacy.comment, legacy.quote, legacy.section, '', legacy.segments.map(s => [s.blockId, s.topLevelId, s.blockType, s.start, s.end, s.quote, s.prefix, s.suffix, s.blockText])]
    expect(await annotationFingerprint(legacy, '')).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'))
  })
  it('大表只输出 256 码点摘要，30 条对象共享快照且要求不会截断', () => {
    const doc = fixture(); cell(doc).content = [paragraph('😀'.repeat(10000))]
    const selected = note(doc, 'table', 'table')
    expect(Array.from(selected.target!.type === 'text' ? '' : selected.target!.summary)).toHaveLength(256)
    expect(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ ...selected, id: `${i}`, comment: '要'.repeat(2000) })))).not.toContain('😀'.repeat(257))
  })
  it('Agent 仅改目标单元格保留无关完整 JSON，跨度改变不能复用原 ID', () => {
    const doc = fixture(), next = structuredClone(doc.content[2]!)
    next.content![0]!.content![1]!.content![0]!.content![0]!.text = '已修改'
    const result = applySuggestionOperations({ title: '', contentJson: doc }, [{ op: 'replace_block', targetDiffId: 'table', node: next }])
    expect(result.contentJson.content[2]!.content![0]!.content![0]).toEqual(richTextProseMirrorSchema.nodeFromJSON(doc).toJSON().content[2].content[0].content[0])
    next.content![0]!.content![1]!.attrs!.colspan = 2
    expect(() => applySuggestionOperations({ title: '', contentJson: doc }, [{ op: 'replace_block', targetDiffId: 'table', node: next }])).toThrow('新身份')
  })
  it('旧 Yjs 只补单元格身份，重复升级保持身份/文本/格式，Diff 不报告身份变化', () => {
    const original = richTextProseMirrorSchema.nodeFromJSON(fixture()).toJSON() as RichTextDocument
    function strip(node: RichTextNode) { if (['tableCell', 'tableHeader'].includes(node.type)) delete node.attrs!.diffId; node.content?.forEach(strip) }
    original.content.forEach(strip)
    const doc = prosemirrorJSONToYDoc(richTextProseMirrorSchema, original, 'default')
    try {
      const before = Y.encodeStateAsUpdate(doc), vector = Y.encodeStateVector(doc)
      expect(upgradeCollaborativeCellIds(doc)).toBe(3)
      const upgraded = readCollaborationDocument(doc).contentJson
      expect(upgradeCollaborativeCellIds(doc)).toBe(0)
      const clone = new Y.Doc()
      try {
        Y.applyUpdate(clone, before); Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc, vector))
        expect(readCollaborationDocument(clone).contentJson).toEqual(upgraded)
      } finally { clone.destroy() }
      expect(sameVersionContent({ title: '', contentJson: original }, { title: '', contentJson: upgraded })).toBe(true)
      expect(buildRichTextDiff(original, upgraded).counts.modified).toBe(0)
    } finally { doc.destroy() }
  })
})
