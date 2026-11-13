// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Markdown } from '@tiptap/markdown'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { TableKit } from '@tiptap/extension-table'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { EditorClipboard, MarkdownPaste, selectedClipboardText } from '../../app/components/editor/clipboard-extension'
import { setTaskItemChecked } from '../../app/components/editor/task-list-commands'
import { captureSelectionHistoryAnchor } from '../../app/components/editor/selection-history-capture'
import { captureAnnotation } from '../../app/components/editor/annotation-capture'
import { RequirementTaskItem, RequirementTaskList } from '../../shared/editor/task-list'
import { BLOCK_NODE_TYPES, ensureBlockIds, extractPlainText, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { parseRichTextDocument } from '../../shared/editor/validation'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'
import { instantiateTemplate } from '../../shared/documents/templates'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { buildSelectionHistory, selectedTaskItems } from '../../shared/diff/selection-history'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'
import { createCollaborationDocument, readCollaborationDocument } from '../../shared/collaboration/document'
import { agentDocumentSchema } from '../../shared/agent/schema'
import { resolveAnnotation } from '../../shared/agent/annotations'
import { agentRequestSchema } from '../../shared/agent/suggestions'

const p = (id: string, text = ''): RichTextNode => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const item = (id: string, text: string, checked = false): RichTextNode => ({ type: 'taskItem', attrs: { diffId: id, checked }, content: [p(`${id}-p`, text)] })
const sample = (): RichTextDocument => ({ type: 'doc', content: [
  { type: 'taskList', attrs: { diffId: 'tasks' }, content: [item('a', '完成验收😀'), item('b', '上线检查', true)] }, p('tail'),
] })
const editors: Editor[] = [], docs: Y.Doc[] = []
function mount(content = sample(), collaborative = false, doc?: Y.Doc) {
  if (collaborative && !doc) { doc = createCollaborationDocument({ title: '', contentJson: structuredClone(content) }); docs.push(doc) }
  const editor = new Editor({ content: collaborative ? undefined : content, enablePasteRules: false,
    extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId, RequirementTaskList, RequirementTaskItem, TableKit,
      EditorClipboard, Markdown, MarkdownPaste, ...(collaborative ? [Collaboration.configure({ document: doc! })] : [])] })
  editors.push(editor)
  return { editor, doc }
}
function select(editor: Editor, id: string, offset = 1) {
  editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) editor.commands.setTextSelection(pos + offset) })
}
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection
    if (!editor.view.someProp('handleTextInput', fn => fn(editor.view, from, to, char, () => editor.state.tr.insertText(char)))) editor.view.dispatch(editor.state.tr.insertText(char))
  }
}
function ids(node: RichTextNode): string[] {
  return [...(node.attrs?.diffId ? [String(node.attrs.diffId)] : []), ...(node.content ?? []).flatMap(ids)]
}
afterEach(() => { editors.splice(0).forEach(e => e.destroy()); docs.splice(0).forEach(d => d.destroy()) })

describe('任务清单模型与边界', () => {
  it('注册官方节点、布尔状态、稳定身份与 Agent 能力', () => {
    const content = sample()
    content.content[0]!.content![0]!.content!.push({ type: 'taskList', content: [item('nested', '嵌套任务')] })
    expect(parseRichTextDocument(content)).toEqual(content)
    expect(BLOCK_NODE_TYPES).toEqual(expect.arrayContaining(['taskList', 'taskItem']))
    ensureBlockIds(content)
    const assigned = ids(content)
    expect(assigned.every(Boolean)).toBe(true)
    expect(new Set(assigned).size).toBe(assigned.length)
    expect(ids(ensureBlockIds(content))).toEqual(assigned)
    const copied = instantiateTemplate(content)
    expect(ids(copied).some(id => assigned.includes(id))).toBe(false)
    expect(copied.content[0]!.content![1]!.attrs!.checked).toBe(true)
    const schema = agentDocumentSchema()
    expect(schema.capabilities).toContain('task_lists')
    expect(schema.nodes.taskList?.content).toBe('taskItem+')
    expect(schema.nodes.taskItem?.content).toBe('paragraph block*')
    expect(schema.examples.taskList).toBeDefined()
  })
  it.each(['true', 1, null, {}, []])('拒绝非布尔 checked %j', checked => {
    const content = sample(); content.content[0]!.content![0]!.attrs!.checked = checked
    expect(() => parseRichTextDocument(content)).toThrow('checked must be a boolean')
    expect(agentRequestSchema.safeParse({ action: 'create', requestId: 'request_task_invalid', title: '清单', changeNote: '创建', contentJson: content }).success).toBe(false)
  })
  it('拒绝未知属性、空清单、错误条目类型和无开头段落', () => {
    const list = sample().content[0]!
    for (const node of [
      { ...list, attrs: { surprise: true } }, { ...list, content: [] }, { ...list, content: [p('bad')] },
      { ...list, content: [{ ...item('bad', ''), attrs: { checked: false, mystery: true } }] },
      { ...list, content: [{ ...item('bad', ''), content: [{ type: 'taskList', content: [item('deep', '')] }] }] },
      item('orphan', '不能在文档根部'),
    ]) expect(() => parseRichTextDocument({ type: 'doc', content: [node] })).toThrow()
  })
  it('缺省未勾选不制造差异，真实勾选改变正文；派生文本保留标记和格式间原文', () => {
    const content = sample(), missing = sample()
    delete missing.content[0]!.content![0]!.attrs!.checked
    expect(parseRichTextDocument(missing)).toEqual(missing)
    expect(sameRichTextContent(missing, content)).toBe(true)
    expect(buildRichTextDiff(missing, content).counts.modified).toBe(0)
    content.content[0]!.content![0]!.content![0]!.content = [{ type: 'text', text: '完成' }, { type: 'text', text: '验收', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }]
    expect(extractPlainText(content)).toBe('[ ] 完成验收\n下一行\n[x] 上线检查')
    const changed = sample(); changed.content[0]!.content![0]!.attrs!.checked = true
    expect(sameRichTextContent(missing, changed)).toBe(false)
  })
  it('尾段只在写入时补齐，模板与 Yjs 二进制重载保留任务状态和身份', () => {
    const content = sample(); content.content.pop()
    const normalized = normalizeTrailingParagraph(content)
    expect(normalized.content.at(-1)!.type).toBe('paragraph')
    expect(normalizeTrailingParagraph(normalized)).toEqual(normalized)
    const source = createCollaborationDocument({ title: '', contentJson: normalized }), restored = new Y.Doc()
    docs.push(source, restored)
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(source))
    expect(readCollaborationDocument(restored)).toEqual(readCollaborationDocument(source))
    const { editor } = mount(normalized, true, restored)
    expect(editor.getJSON()).toEqual(readCollaborationDocument(source).contentJson)
  })
})

describe.each([false, true])('任务操作与剪贴板（协作=%s）', collaborative => {
  it('勾选和取消各自撤销，前后输入独立；只读无变化', () => {
    const { editor } = mount(sample(), collaborative)
    select(editor, 'a-p'); editor.commands.insertContent('前')
    const before = editor.getJSON(), selection = editor.state.selection.toJSON()
    expect(setTaskItemChecked(editor, 'a', true)).toBe(true)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    const checked = editor.getJSON()
    editor.commands.insertContent('后')
    editor.commands.undo(); expect(editor.getJSON()).toEqual(checked)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
    editor.commands.redo(); expect(editor.getJSON()).toEqual(checked)
    setTaskItemChecked(editor, 'a', false)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(checked)
    editor.setEditable(false)
    expect(setTaskItemChecked(editor, 'a', false)).toBe(false)
    expect(editor.getJSON()).toEqual(checked)
  })
  it.each(['[] ', '[ ] ', '[x] '])('行首输入 %s 转换为任务，拆项默认未勾选，空项退出', syntax => {
    const { editor } = mount({ type: 'doc', content: [p('start')] }, collaborative)
    type(editor, syntax)
    expect(editor.state.doc.firstChild!.type.name).toBe('taskList')
    expect(editor.state.doc.firstChild!.firstChild!.attrs.checked).toBe(syntax.includes('x'))
    type(editor, '验收')
    editor.commands.keyboardShortcut('Enter')
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(editor.state.doc.firstChild!.child(1).attrs.checked).toBe(false)
    editor.commands.keyboardShortcut('Enter')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.isActive('taskList')).toBe(false)
    expect(parseRichTextDocument(editor.getJSON())).toBeTruthy()
    const assigned = ids(editor.getJSON() as RichTextDocument)
    expect(new Set(assigned).size).toBe(assigned.length)
  })
  it('Tab 嵌套、Shift+Tab 提升保留身份和状态', () => {
    const { editor } = mount(sample(), collaborative)
    select(editor, 'b-p')
    editor.commands.keyboardShortcut('Tab')
    const nested = editor.state.doc.firstChild!.firstChild!.lastChild!
    expect(nested.type.name).toBe('taskList'); expect(nested.firstChild!.attrs.diffId).toBe('b')
    expect(nested.firstChild!.attrs.checked).toBe(true)
    editor.commands.keyboardShortcut('Shift-Tab')
    expect(editor.state.doc.firstChild!.child(1).attrs.diffId).toBe('b')
  })
  it('HTML / Markdown 互转保留嵌套状态；复制纯文字无复选框，粘贴重分配身份', () => {
    const { editor } = mount(sample(), collaborative)
    select(editor, 'b-p'); editor.commands.keyboardShortcut('Tab')
    const content = editor.getJSON()
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
    expect(DOMParser.fromSchema(editor.schema).parse(container).toJSON()).toEqual(content)
    const markdown = editor.getMarkdown()
    expect(markdown).toContain('- [ ] 完成验收😀'); expect(markdown).toContain('- [x] 上线检查')
    const parsed = editor.markdown!.parse(markdown) as RichTextDocument
    expect(parsed.content[0]!.type).toBe('taskList')
    expect(extractPlainText(parsed)).toBe('[ ] 完成验收😀\n[x] 上线检查')
    editor.commands.selectAll()
    expect(selectedClipboardText(editor.state)).toBe('完成验收😀\n上线检查\n')
    const copied = editor.view.serializeForClipboard(editor.state.selection.content())
    const { editor: target } = mount({ type: 'doc', content: [p('empty')] }, collaborative)
    target.view.pasteHTML(copied.dom.innerHTML)
    expect(extractPlainText(target.getJSON() as RichTextDocument)).toBe(extractPlainText(content as RichTextDocument))
    expect(ids(target.getJSON() as RichTextDocument).some(id => ids(content as RichTextDocument).includes(id))).toBe(false)
  })
  it('GFM 粘贴保持任务语义，纯文本粘贴快捷键保留字面输入', () => {
    const { editor } = mount({ type: 'doc', content: [p('start')] }, collaborative)
    const data = new DataTransfer(); data.setData('text/plain', '- [ ] 未完成\n- [x] 已完成')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(editor.state.doc.firstChild!.type.name).toBe('taskList')
    expect(editor.state.doc.firstChild!.child(1).attrs.checked).toBe(true)
    const { editor: plain } = mount({ type: 'doc', content: [p('plain')] }, collaborative)
    plain.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true }))
    plain.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(plain.state.doc.firstChild!.type.name).toBe('paragraph')
    expect(plain.state.doc.textContent).toContain('- [ ] 未完成')
  })
})

describe('任务 Diff、历史、标注与同步', () => {
  it('状态变化对齐为单个修改，字符不增删；草稿恢复状态及删除的条目', () => {
    const base = sample(), target = sample(); target.content[0]!.content![0]!.attrs!.checked = true
    const pairs = buildRichTextDiff(base, target).pairs
    expect(pairs[0]!.status).toBe('modified')
    expect(pairs[0]!.baseChunks).toEqual(pairs[0]!.targetChunks)
    expect(revertDraftChange(target, base, { status: 'modified', pairs: [pairs[0]!] }).document).toEqual(base)
    const removed = sample(); removed.content[0]!.content!.pop()
    const deletion = buildRichTextDiff(base, removed).pairs.find(pair => pair.status === 'deleted')!
    expect(revertDraftChange(removed, base, { status: 'deleted', pairs: [deletion] }).document).toEqual(base)
    const inserted = buildRichTextDiff({ type: 'doc', content: [p('tail')] }, base).pairs.filter(pair => pair.status === 'inserted')
    expect(revertDraftChange(base, { type: 'doc', content: [p('tail')] }, { status: 'inserted', pairs: inserted }).document.content).toEqual([p('tail')])
  })
  it.each([false, true])('转换列表后恢复修改/删除的单项不会留下非法混合条目（删除=%s）', deleted => {
    const base = sample(), target = sample()
    target.content[0]!.type = 'bulletList'
    for (const child of target.content[0]!.content!) { child.type = 'listItem'; delete child.attrs!.checked }
    if (deleted) target.content[0]!.content!.shift()
    const pair = buildRichTextDiff(base, target).pairs[0]!
    const restored = revertDraftChange(target, base, { status: deleted ? 'deleted' : 'modified', pairs: [pair] }).document
    expect(parseRichTextDocument(restored)).toEqual(restored)
    expect(restored).toEqual(base)
  })
  it('表格内的嵌套勾选进入单元格 Diff 并可恢复，未改文字不标为增删', () => {
    const base: RichTextDocument = { type: 'doc', content: [{ type: 'table', attrs: { diffId: 'table' }, content: [
      { type: 'tableRow', content: [{ type: 'tableCell', attrs: { diffId: 'cell' }, content: [sample().content[0]!] }] },
    ] }, p('tail')] }
    const target = structuredClone(base)
    target.content[0]!.content![0]!.content![0]!.content![0]!.content![0]!.attrs!.checked = true
    const pair = buildRichTextDiff(base, target).pairs[0]!
    expect(pair.status).toBe('modified')
    expect(pair.table!.rows[0]!.cells[0]!.status).toBe('modified')
    expect(pair.table!.rows[0]!.cells[0]!.baseChunks).toEqual(pair.table!.rows[0]!.cells[0]!.targetChunks)
    expect(revertDraftChange(target, base, { status: 'modified', pairs: [pair] }).document).toEqual(base)
  })
  it('嵌套任务局部选区追踪子项，排除选区外勾选，支持条目内第二段', () => {
    const base = sample()
    base.content[0]!.content![0]!.content!.push({ type: 'taskList', attrs: { diffId: 'nested' }, content: [
      { ...item('deep', '子项内容', true), content: [p('deep-p', '子项内容'), p('deep-second', '补充说明')] },
    ] })
    const { editor } = mount(base)
    function historyFor(paragraph: string, target: RichTextDocument) {
      select(editor, paragraph)
      const from = editor.state.selection.from
      editor.commands.setTextSelection({ from, to: from + 2 })
      const captured = captureSelectionHistoryAnchor(editor)
      expect(captured.ok).toBe(true); if (!captured.ok) throw new Error(captured.message)
      return buildSelectionHistory(captured.anchor, [{ id: 'draft', label: '草稿', version: null, document: target }, { id: 'v1', label: 'v1', version: 1, document: base }]).entries[0]!
    }
    const changed = structuredClone(base)
    changed.content[0]!.content![0]!.content![1]!.content![0]!.attrs!.checked = false
    expect(historyFor('a-p', changed).status).toBe('unchanged')
    for (const paragraph of ['deep-p', 'deep-second']) {
      const result = historyFor(paragraph, changed)
      expect(result.status).toBe('modified')
      const segment = result.segments[0]!
      expect(selectedTaskItems(segment.targetNode, segment.targetStart!, segment.targetEnd!).map(node => node.attrs?.diffId)).toEqual(['deep'])
    }
    const parentChanged = structuredClone(base)
    parentChanged.content[0]!.content![0]!.attrs!.checked = true
    expect(historyFor('deep-p', parentChanged).status).toBe('unchanged')
  })
  it('状态进入选区历史；嵌套文字标注使用段落身份，勾选不使文字定位失效', () => {
    const base = sample(), { editor } = mount(base)
    select(editor, 'a-p', 2)
    const captured = captureSelectionHistoryAnchor(editor)
    expect(captured.ok).toBe(true); if (!captured.ok) return
    setTaskItemChecked(editor, 'a', true)
    const target = editor.getJSON() as RichTextDocument
    const history = buildSelectionHistory(captured.anchor, [{ id: 'draft', label: '草稿', version: null, document: target }, { id: 'v1', label: 'v1', version: 1, document: base }])
    expect(history.entries[0]!.status).toBe('modified')
    select(editor, 'b-p'); editor.commands.keyboardShortcut('Tab')
    const from = editor.state.selection.from
    editor.commands.setTextSelection({ from, to: from + 2 })
    const note = captureAnnotation(editor)
    expect(note.quote).toBe('上线'); expect(note.segments[0]!.topLevelId).toBe('tasks')
    setTaskItemChecked(editor, 'b', false)
    expect(resolveAnnotation(note, editor.getJSON()).status).toBe('exact')
  })
  it('两人合并勾选与文字，个人撤销保留远端输入', () => {
    const { editor: local, doc: left } = mount(sample(), true)
    const right = new Y.Doc(); docs.push(right); Y.applyUpdate(right, Y.encodeStateAsUpdate(left!))
    const { editor: remote } = mount(sample(), true, right)
    setTaskItemChecked(local, 'a', true)
    select(remote, 'a-p'); remote.commands.insertContent('远端')
    Y.applyUpdate(left!, Y.encodeStateAsUpdate(right)); Y.applyUpdate(right, Y.encodeStateAsUpdate(left!))
    expect(local.getJSON()).toEqual(remote.getJSON())
    local.commands.undo(); Y.applyUpdate(right, Y.encodeStateAsUpdate(left!))
    expect(remote.state.doc.firstChild!.firstChild!.attrs.checked).toBe(false)
    expect(remote.state.doc.textContent).toContain('远端')
  })
})
