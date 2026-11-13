// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Markdown } from '@tiptap/markdown'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { EditableDetails, EditableDetailsContent, RequirementDetailsSummary } from '../../app/components/editor/details-extension'
import { revealDetailsAncestors } from '../../app/components/editor/details-visibility'
import { captureSelectionHistoryAnchor } from '../../app/components/editor/selection-history-capture'
import { captureAnnotation } from '../../app/components/editor/annotation-capture'
import { EditorClipboard, MarkdownPaste, selectedClipboardText } from '../../app/components/editor/clipboard-extension'
import { ensureBlockIds, extractPlainText, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { parseRichTextDocument } from '../../shared/editor/validation'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'
import { instantiateTemplate } from '../../shared/documents/templates'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { buildSelectionHistory, extractSelectionHistoryBlocks } from '../../shared/diff/selection-history'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'
import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { agentDocumentSchema } from '../../shared/agent/schema'
import { captureNodeTarget, resolveAnnotation } from '../../shared/agent/annotations'

const p = (id: string, text = ''): RichTextNode => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const sample = (): RichTextDocument => ({ type: 'doc', content: [{ type: 'details', attrs: { diffId: 'details' }, content: [
  { type: 'detailsSummary', attrs: { diffId: 'summary' }, content: [{ type: 'text', text: '补充' }, { type: 'text', text: '说明', marks: [{ type: 'bold' }] }] },
  { type: 'detailsContent', content: [p('inside', '内部正文😀'), p('second', '第二段')] },
] }, p('tail')] })
const editors: Editor[] = [], docs: Y.Doc[] = []
function mount(content = sample(), collaborative = false, existing?: Y.Doc) {
  const doc = existing ?? (collaborative ? createCollaborationDocument({ title: '', contentJson: content }) : undefined)
  if (doc && !existing) docs.push(doc)
  const element = document.createElement('div'); document.body.append(element)
  const editor = new Editor({ element, content: collaborative ? undefined : content, enablePasteRules: false,
    extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId,
      EditableDetails, EditableDetailsContent, RequirementDetailsSummary, Markdown, EditorClipboard, MarkdownPaste,
      ...(doc ? [Collaboration.configure({ document: doc })] : [])],
  })
  editors.push(editor)
  return { editor, doc }
}
function select(editor: Editor, id: string) {
  editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) {
    revealDetailsAncestors(editor.view.nodeDOM(pos))
    editor.commands.setTextSelection(pos + 1)
  } })
}
const ids = (node: RichTextNode): string[] => [...(node.attrs?.diffId ? [String(node.attrs.diffId)] : []), ...(node.content ?? []).flatMap(ids)]
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); docs.splice(0).forEach(doc => doc.destroy()); document.body.replaceChildren() })

describe('折叠块数据与输入', () => {
  it('官方结构、摘要身份、纯文本、尾段、模板及 Agent schema 一致', () => {
    const content = sample()
    expect(parseRichTextDocument(content)).toEqual(content)
    expect(extractPlainText(content)).toBe('补充说明\n内部正文😀\n第二段')
    ensureBlockIds(content)
    expect(ids(content)).toEqual(ids(sample()))
    expect(ids(instantiateTemplate(content)).some(id => ids(content).includes(id))).toBe(false)
    expect(normalizeTrailingParagraph({ type: 'doc', content: [content.content[0]!] }).content.at(-1)?.type).toBe('paragraph')
    const schema = agentDocumentSchema()
    expect(schema.capabilities).toContain('details')
    expect(schema.nodes.details?.content).toBe('detailsSummary detailsContent')
    expect(schema.nodes.details?.attrs).not.toHaveProperty('open')
    expect(schema.annotationNodes.details).toEqual({ version: 1, label: '折叠块' })
    const mixed = sample()
    mixed.content[0]!.content![1]!.content!.push(
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('list-p', '列表')] }] },
      { type: 'image', attrs: { src: '/uploads/details.png', align: 'left' }, content: [{ type: 'imageCaption', content: [{ type: 'text', text: '图片说明' }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('cell-p', '表格')] }] }] },
      instantiateTemplate(sample()).content[0]!,
    )
    expect(() => parseRichTextDocument(mixed)).not.toThrow()
  })
  it('拒绝视图属性与非法嵌套', () => {
    const node = sample().content[0]!
    for (const invalid of [
      { ...node, attrs: { open: true } }, { ...node, attrs: { hidden: true } },
      { ...node, content: [node.content![1]!, node.content![0]!] },
      { ...node, content: [node.content![0]!, { type: 'detailsContent', content: [] }] },
      { ...node, content: [{ type: 'detailsSummary', content: [p('bad')] }, node.content![1]!] },
      node.content![0]!, node.content![1]!,
    ]) expect(() => parseRichTextDocument({ type: 'doc', content: [invalid] })).toThrow()
  })
  it('HTML/Markdown 往返保留摘要格式与全部隐藏内容；复制不会携带展开状态或旧 ID', () => {
    const { editor } = mount()
    const div = document.createElement('div')
    div.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
    expect(div.innerHTML).not.toMatch(/hidden|open=|button/)
    expect(DOMParser.fromSchema(editor.schema).parse(div).toJSON()).toEqual(editor.getJSON())
    const markdown = editor.getMarkdown()
    expect(markdown).not.toContain('diffId')
    expect(markdown).toContain('补充**说明**')
    const parsed = editor.markdown!.parse(markdown) as RichTextDocument
    expect(sameRichTextContent(normalizeTrailingParagraph(parsed), sample()), JSON.stringify(parsed)).toBe(true)
    editor.commands.selectAll()
    expect(selectedClipboardText(editor.state)).toBe('补充说明\n内部正文😀\n第二段\n')
    const html = editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML
    const { editor: target } = mount({ type: 'doc', content: [p('empty')] })
    target.view.pasteHTML(html)
    expect(extractPlainText(target.getJSON() as RichTextDocument)).toBe(extractPlainText(sample()))
    expect(ids(target.getJSON() as RichTextDocument).some(id => ids(sample()).includes(id))).toBe(false)
    const { editor: external } = mount({ type: 'doc', content: [p('empty')] })
    external.view.pasteHTML('<details open><summary>外部摘要</summary><p>外部内容</p><ul><li>列表内容</li></ul></details>')
    expect(external.state.doc.firstChild?.type.name).toBe('details')
    expect(extractPlainText(external.getJSON() as RichTextDocument)).toBe('外部摘要\n外部内容\n列表内容')
    expect(external.getJSON().content?.[0]?.attrs).not.toHaveProperty('open')
    const { editor: pasted } = mount({ type: 'doc', content: [p('empty')] })
    const data = new DataTransfer(); data.setData('text/plain', markdown)
    pasted.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(pasted.state.doc.firstChild?.type.name).toBe('details')
    expect(sameRichTextContent(pasted.getJSON() as RichTextDocument, sample())).toBe(true)
  })
})

describe.each([false, true])('折叠块会话状态与历史（协作=%s）', collaborative => {
  it('切换、beforematch、只读展开都不发正文更新或改变 Yjs，重绘记住状态', () => {
    const { editor, doc } = mount(sample(), collaborative)
    const before = editor.getJSON(), state = doc && Array.from(Y.encodeStateAsUpdate(doc))
    const target = captureNodeTarget(before, 'details')
    const note = { id: 'note', target, comment: '核对补充', quote: '', section: '', segments: [] }
    let updates = 0; editor.on('update', () => updates++)
    const button = () => editor.view.dom.querySelector<HTMLButtonElement>('.requirement-details__toggle')!
    const body = () => editor.view.dom.querySelector<HTMLElement>('[data-type="detailsContent"]')!
    expect(body().getAttribute('hidden')).toBe('until-found')
    button().click(); expect(body().hasAttribute('hidden')).toBe(false)
    editor.view.updateState(editor.state)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    button().click(); body().dispatchEvent(new Event('beforematch'))
    expect(body().hasAttribute('hidden')).toBe(false)
    editor.setEditable(false, false)
    button().click(); button().click()
    expect(updates).toBe(0)
    expect(editor.getJSON()).toEqual(before)
    expect(resolveAnnotation(note, editor.getJSON()).status).toBe('exact')
    if (doc) expect(Array.from(Y.encodeStateAsUpdate(doc))).toEqual(state)
  })
  it('摘要和内部文字可标注、追溯和独立撤销，取消容器保留内容', () => {
    const { editor } = mount(sample(), collaborative)
    select(editor, 'summary')
    const from = editor.state.selection.from
    editor.commands.setTextSelection({ from, to: from + 2 })
    const annotation = captureAnnotation(editor)
    expect(annotation.segments[0]?.blockId).toBe('summary')
    expect(resolveAnnotation(annotation, editor.getJSON()).status).toBe('exact')
    select(editor, 'inside')
    const captured = captureSelectionHistoryAnchor(editor)
    expect(captured.ok).toBe(true); if (!captured.ok) return
    expect(captured.anchor.segments[0]?.blockId).toBe('inside')
    const before = editor.getJSON() as RichTextDocument
    editor.commands.insertContent('新增')
    const changed = editor.getJSON() as RichTextDocument
    const history = buildSelectionHistory(captured.anchor, [{ id: 'draft', label: '草稿', version: null, document: changed }, { id: 'v1', label: 'v1', version: 1, document: before }])
    expect(history.entries[0]?.changed).toBe(true)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
    editor.commands.redo(); expect(editor.getJSON()).toEqual(changed)
    select(editor, 'summary'); expect(editor.commands.unsetDetails()).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(editor.state.doc.firstChild?.attrs.diffId).toBe('summary')
    expect(editor.state.doc.textContent).toContain('新增内部正文')
  })
})

describe('折叠块对齐与协作', () => {
  it('内部段落按身份对齐、摘要单独比较、整体恢复保留嵌套结构', () => {
    const base = sample(), target = sample()
    target.content[0]!.content![1]!.content!.unshift(p('added', '插入段'))
    const pair = buildRichTextDiff(base, target).pairs[0]!
    expect(pair.status).toBe('modified')
    const nested = buildRichTextDiff({ type: 'doc', content: base.content[0]!.content![1]!.content! }, { type: 'doc', content: target.content[0]!.content![1]!.content! })
    expect(nested.pairs.map(p => [p.id, p.status])).toEqual([['added', 'inserted'], ['inside', 'unchanged'], ['second', 'unchanged']])
    expect(extractSelectionHistoryBlocks(target).map(block => block.id)).toEqual(['summary', 'added', 'inside', 'second', 'tail'])
    expect(revertDraftChange(target, base, { status: 'modified', pairs: [pair] }).document).toEqual(base)
  })
  it('协作者只合并文字；展开不发送更新，二进制重载不重建 Yjs', () => {
    const { editor: left, doc } = mount(sample(), true)
    const remote = new Y.Doc(); docs.push(remote); Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc!))
    const { editor: right } = mount(sample(), true, remote)
    left.view.dom.querySelector<HTMLButtonElement>('.requirement-details__toggle')!.click()
    select(left, 'inside'); left.commands.insertContent('协作')
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc!))
    expect(right.getJSON()).toEqual(left.getJSON())
    expect(right.view.dom.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(left.view.dom.querySelector('button')!.getAttribute('aria-expanded')).toBe('true')
    expect(readCollaborationDocument(remote).contentJson).toEqual(left.getJSON())
  })
})
