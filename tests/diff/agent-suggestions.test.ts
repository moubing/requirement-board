import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { agentRequestSchema, applySuggestionOperations, suggestionInputSchema, type DocumentSnapshot } from '../../shared/agent/suggestions'
import { agentDocumentSchema } from '../../shared/agent/schema'
import { applyCandidateToYDocument } from '../../shared/agent/collaboration'
import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { ensureBlockIds } from '../../shared/editor/document'

const base = (): DocumentSnapshot => ({ title: '登录需求', contentJson: { type: 'doc', content: [
  { type: 'paragraph', attrs: { diffId: 'intro' }, content: [{ type: 'text', text: '保留这段', marks: [{ type: 'bold' }] }] },
  { type: 'bulletList', attrs: { diffId: 'list' }, content: [{ type: 'listItem', attrs: { diffId: 'item' }, content: [
    { type: 'paragraph', attrs: { diffId: 'nested' }, content: [{ type: 'text', text: '原条目' }] },
  ] }] },
] } })

describe('AI 文档操作', () => {
  it('返回可序列化的真实 schema，并严格校验请求字段', () => {
    const schema = JSON.parse(JSON.stringify(agentDocumentSchema()))
    expect(schema.schemaVersion).toBe(3)
    expect(schema.nodes.image.content).toBe('imageCaption')
    expect(schema.nodes.table).toBeDefined()
    expect(schema.marks.bold).toBeDefined()
    expect(schema.operations.properties.operations).toBeDefined()
    expect(schema.capabilitiesVersion).toBe(13)
    expect(schema.capabilities).toContain('callout_tones')
    expect(schema.nodes.callout.attrs.tone.enum).toEqual(['note', 'tip', 'warning', 'danger'])
    expect(schema.rules.callouts.tones.danger.label).toBe('风险')
    expect(schema.capabilities).toEqual(expect.arrayContaining(['document_relations', 'paginated_search']))
    expect(schema.documentSearch.defaults).toMatchObject({ page: 1, pageSize: 20 })
    expect(schema.relatedDocuments.input.properties.documentIds.maxItems).toBe(100)
    expect(schema.annotationNodes.callout).toEqual({ version: 1, label: '提示块' })
    expect(schema.capabilities).toContain('annotation_completion')
    expect(schema.operations.properties.completedAnnotations).toBeDefined()
    expect(schema.capabilities).toContain('direct_execution')
    expect(schema.create.properties.contentJson).toBeDefined()
    expect(suggestionInputSchema.safeParse({ snapshotId: 'snap_abcdefghijklmnop', requestId: 'request_abcdefghijkl', changeNote: '说明', operations: [{ op: 'delete_block', targetDiffId: 'intro', unknown: true }] }).success).toBe(false)
  })

  it('新建允许服务端分配 ID，正文与属性仍严格校验，模式不由请求内容指定', () => {
    const input = { action: 'create', requestId: 'request_abcdefghijkl', title: '新建', changeNote: '初始版本',
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] } }
    expect(agentRequestSchema.safeParse(input).success).toBe(true)
    expect(agentRequestSchema.safeParse({ ...input, takeover: true }).success).toBe(false)
    expect(agentRequestSchema.safeParse({ ...input, properties: { reporterId: 'someone' } }).success).toBe(false)
    expect(agentRequestSchema.safeParse({ ...input, contentJson: { type: 'doc', content: [{ type: 'unknown' }] } }).success).toBe(false)
    expect(suggestionInputSchema.safeParse({ snapshotId: 'snap_abcdefghijklmnop', requestId: input.requestId, changeNote: '只改属性',
      operations: [], properties: { priority: 'high' }, saveRevision: { changeNote: '' } }).success).toBe(false)
  })

  it('保留原有格式和 ID，只给新块分配 ID，且不修改输入', () => {
    const original = base()
    const before = structuredClone(original)
    const candidate = applySuggestionOperations(original, [{ op: 'insert_blocks', anchorDiffId: 'list', position: 'after', nodes: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '验收标准' }] },
    ] }], () => 'new-id')
    expect(original).toEqual(before)
    expect(candidate.contentJson.content[0]!.content![0]!.marks).toEqual([{ type: 'bold' }])
    expect(candidate.contentJson.content[2]!.attrs).toMatchObject({ diffId: 'new-id', level: 2 })
  })

  it('拒绝嵌套目标、其他块 ID、非法节点、丢失根 ID 和删除全部内容', () => {
    expect(() => applySuggestionOperations(base(), [{ op: 'delete_block', targetDiffId: 'nested' }])).toThrow('顶层块')
    expect(() => applySuggestionOperations(base(), [{ op: 'insert_blocks', anchorDiffId: 'intro', position: 'after', nodes: [base().contentJson.content[1]!] }])).toThrow('块 ID')
    expect(() => applySuggestionOperations(base(), [{ op: 'replace_block', targetDiffId: 'intro', node: { type: 'paragraph' } }])).toThrow('保留目标')
    expect(() => applySuggestionOperations(base(), [{ op: 'replace_block', targetDiffId: 'intro', node: { type: 'html', attrs: { diffId: 'intro' } } }])).toThrow()
    expect(() => applySuggestionOperations(base(), [{ op: 'delete_block', targetDiffId: 'intro' }, { op: 'delete_block', targetDiffId: 'list' }])).toThrow()
    expect(() => applySuggestionOperations(base(), [{ op: 'set_title', title: '一' }, { op: 'set_title', title: '二' }])).toThrow('一次标题')
  })

  it('在原始 Yjs 历史上应用候选，保留未修改节点和原客户端时钟', () => {
    const original = createCollaborationDocument(base())
    const document = new Y.Doc()
    Y.applyUpdate(document, Y.encodeStateAsUpdate(original))
    const clocks = Y.decodeStateVector(Y.encodeStateVector(document))
    const kept = document.getXmlFragment('default').get(0)
    const snapshot = readCollaborationDocument(document)
    const list = structuredClone(snapshot.contentJson.content[1]!)
    list.content![0]!.content![0]!.content = [{ type: 'text', text: '增加校验' }]
    const candidate = applySuggestionOperations(snapshot, [{ op: 'replace_block', targetDiffId: 'list', node: list }, { op: 'set_title', title: '登录校验需求' }])
    applyCandidateToYDocument(document, candidate)
    expect(readCollaborationDocument(document)).toEqual(candidate)
    expect(document.getXmlFragment('default').get(0)).toBe(kept)
    const next = Y.decodeStateVector(Y.encodeStateVector(document))
    for (const [client, clock] of clocks) expect(next.get(client)).toBeGreaterThanOrEqual(clock)
    Y.applyUpdate(original, Y.encodeStateAsUpdate(document))
    expect(readCollaborationDocument(original)).toEqual(candidate)
    document.destroy(); original.destroy()
  })

  it('表格、图片说明、格式在结构化替换后仍可由共同文档准确导出', () => {
    const contentJson = ensureBlockIds({ type: 'doc', content: [
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧单元格' }] }] }] }] },
      { type: 'image', attrs: { src: 'https://example.com/a.png', align: 'center' }, content: [{ type: 'imageCaption', content: [{ type: 'text', text: '原说明' }] }] },
    ] })
    const doc = createCollaborationDocument({ title: '示例', contentJson })
    const snapshot = readCollaborationDocument(doc)
    const table = structuredClone(snapshot.contentJson.content[0]!)
    table.content![0]!.content![0]!.content![0]!.content = [{ type: 'text', text: '新单元格', marks: [{ type: 'bold' }] }]
    const candidate = applySuggestionOperations(snapshot, [{ op: 'replace_block', targetDiffId: table.attrs!.diffId as string, node: table }])
    applyCandidateToYDocument(doc, candidate)
    expect(readCollaborationDocument(doc)).toEqual(candidate)
    expect(candidate.contentJson.content[1]).toEqual(snapshot.contentJson.content[1])
    doc.destroy()
  })
})
