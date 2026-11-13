// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { addNodeContributors, attributionFromReceipts, changedAttributionNodes, emptyAttribution, newerAttribution } from '../../shared/collaboration/attribution'
import type { RichTextDocument } from '../../shared/editor/document'

const editors: Editor[] = [], docs: Y.Doc[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); docs.splice(0).forEach(doc => doc.destroy()) })
function fixture() {
  const server = createCollaborationDocument({ title: '需求', contentJson: { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' } }] } })
  docs.push(server)
  let snapshot = emptyAttribution({ id: 'v1', version: 1 })
  function client() {
    const doc = new Y.Doc(); docs.push(doc)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(server))
    const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), BlockId, Collaboration.configure({ document: doc })] })
    editors.push(editor)
    return { doc, editor }
  }
  function accept(doc: Y.Doc, name: string | null) {
    const before = readCollaborationDocument(server)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc))
    const changed = changedAttributionNodes(before, readCollaborationDocument(server))
    snapshot = addNodeContributors(snapshot, changed, name ? { userId: name, name } : null)
    return { snapshot, changed }
  }
  return { server, client, accept, current: () => snapshot }
}

describe('节点本版修改人', () => {
  it('输入、替换和加粗统一计入节点名单，保存和重复同步不加入', () => {
    const f = fixture(), a = f.client()
    a.editor.commands.insertContentAt(1, '支持导出报表')
    f.accept(a.doc, '张三')
    const b = f.client()
    b.editor.commands.insertContentAt({ from: 5, to: 7 }, 'Excel 文件')
    f.accept(b.doc, '李四')
    const c = f.client()
    c.editor.chain().setTextSelection({ from: 5, to: 13 }).setBold().run()
    f.accept(c.doc, '王五')
    const result = f.accept(f.client().doc, '赵六')
    expect(result.changed).toEqual([])
    expect(result.snapshot.nodes).toEqual([{ id: 'p1', type: 'paragraph', unknown: false,
      authors: ['张三', '李四', '王五'].map(name => ({ userId: name, name })) }])
  })

  it('两人离线修改同一节点均被记录，重复补交不会增加修改人', () => {
    const f = fixture(), a = f.client(), b = f.client()
    a.editor.commands.insertContentAt(1, '甲')
    b.editor.commands.insertContentAt(1, '乙')
    f.accept(a.doc, '甲'); f.accept(b.doc, '乙')
    expect(f.accept(a.doc, '重复同步').changed).toEqual([])
    expect(f.current().nodes[0]!.authors.map(author => author.name)).toEqual(['甲', '乙'])
  })

  it('修改后撤销仍保留参与者，多次修改去重，拆分的两个节点都计入', () => {
    const f = fixture(), a = f.client()
    a.editor.commands.insertContentAt(1, '第一段第二段')
    f.accept(a.doc, '甲')
    a.editor.chain().setTextSelection({ from: 1, to: 4 }).setBold().run(); f.accept(a.doc, '乙')
    a.editor.chain().setTextSelection({ from: 1, to: 4 }).unsetBold().run(); f.accept(a.doc, '乙')
    const b = f.client()
    b.editor.chain().setTextSelection(4).splitBlock().run()
    const result = f.accept(b.doc, '丙')
    expect(result.changed).toHaveLength(2)
    expect(result.snapshot.nodes[0]!.authors.map(author => author.name)).toEqual(['甲', '乙', '丙'])
    expect(result.snapshot.nodes[1]!.authors.map(author => author.name)).toEqual(['丙'])
  })

  it('节点新增不影响后续节点，移动、删除、图片属性和表格格式都能识别', () => {
    const p = (id: string) => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text: id }] })
    const left = { title: '需求', contentJson: { type: 'doc' as const, content: [p('a'), p('b')] } }
    const right = structuredClone(left)
    right.contentJson.content.unshift(p('new'))
    expect(changedAttributionNodes(left, right).map(node => node.id)).toEqual(['new'])
    right.contentJson.content = [p('b'), p('a')]
    expect(changedAttributionNodes(left, right).map(node => node.id)).toEqual(['a', 'b'])
    right.contentJson.content = [p('b')]
    expect(changedAttributionNodes(left, right).map(node => node.id)).toEqual(['a'])
    const document: RichTextDocument = { type: 'doc', content: [
      { type: 'image', attrs: { diffId: 'image', src: '/image.png', width: 100 } },
      { type: 'table', attrs: { diffId: 'table' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell-p')] }] }] },
    ] }
    const updated = structuredClone(document)
    updated.content[0]!.attrs!.width = 200
    updated.content[1]!.content![0]!.content![0]!.content![0]!.content![0]!.marks = [{ type: 'bold' }]
    expect(changedAttributionNodes({ title: '', contentJson: document }, { title: '', contentJson: updated }).map(node => node.id))
      .toEqual(['image', 'table', 'cell-p'])
  })

  it('名单与文字长度无关，旧同步标记未记录', () => {
    const f = fixture(), a = f.client()
    a.editor.commands.insertContentAt(1, '长'.repeat(20_000))
    const result = f.accept(a.doc, null)
    expect(result.snapshot.nodes).toEqual([{ id: 'p1', type: 'paragraph', authors: [], unknown: true }])
    expect(JSON.stringify(result.snapshot).length).toBeLessThan(250)
  })

  it('旧记录按区间收据汇总，撤销到基准仍有名单，缺失记录不猜保存人', () => {
    const base = { id: 'v3', version: 3, title: '需求', contentJson: { type: 'doc' as const, content: [{ type: 'paragraph', attrs: { diffId: 'p1' } }] } }
    const result = attributionFromReceipts(base, base, [
      { authorId: 'a', authorName: '甲', blockIds: ['p1'], intent: 'edit' },
      { authorId: 'b', authorName: '乙', blockIds: ['p1'], intent: 'restore' },
    ])
    expect(result.baseVersion).toBe(3)
    expect(result.nodes[0]!.authors.map(author => author.name)).toEqual(['甲', '乙'])
    expect(attributionFromReceipts(base, { ...base, title: '旧客户端改标题' }, []).nodes).toEqual([{ id: '$title', type: 'title', authors: [], unknown: true }])
  })

  it('保存后从新版本开始，等序号的旧 HTTP 响应不能恢复上一版名单', () => {
    const previous = { sequence: 9, snapshot: emptyAttribution({ id: 'v3', version: 3 }) }
    const next = { sequence: 9, snapshot: emptyAttribution({ id: 'v4', version: 4 }) }
    expect(newerAttribution(next, previous)).toBe(true)
    expect(newerAttribution(previous, next)).toBe(false)
    expect(newerAttribution({ ...next, sequence: 8 }, next)).toBe(false)
  })
})
