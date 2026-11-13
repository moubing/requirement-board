// @vitest-environment happy-dom

import { Editor, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { Markdown } from '@tiptap/markdown'
import { closeHistory } from '@tiptap/pm/history'
import StarterKit from '@tiptap/starter-kit'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import { EditorClipboard, MarkdownPaste } from '../../app/components/editor/clipboard-extension'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import { ensureBlockIds, type RichTextDocument } from '../../shared/editor/document'
import { draftDocumentSchema } from '../../shared/drafts/validation'

const editors: Editor[] = []
const docs: Y.Doc[] = []
const paragraph = (text = ''): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined })
const ordered = (texts: string[], start = 1, type: string | null = null): JSONContent => ({
  type: 'orderedList', attrs: { start, type }, content: texts.map(text => ({ type: 'listItem', content: [paragraph(text)] })),
})

function createEditor(content: JSONContent[], collaborative = false, sharedDoc?: Y.Doc) {
  const json = ensureBlockIds({ type: 'doc', content } as RichTextDocument)
  const doc = sharedDoc ?? createCollaborationDocument({ title: '连续编号', contentJson: json })
  docs.push(doc)
  const editor = new Editor({
    enablePasteRules: false,
    extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId, EditorClipboard, Markdown, MarkdownPaste,
      ...(collaborative ? [Collaboration.configure({ document: doc })] : [])],
    content: collaborative ? undefined : json,
  })
  editors.push(editor)
  return editor
}

function copyList(texts = ['复制甲', '复制乙']) {
  const editor = createEditor([ordered(texts)])
  editor.commands.setNodeSelection(0)
  return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML
}

function pasteAtEnd(editor: Editor, html: string) {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  editor.view.pasteHTML(html)
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  docs.splice(0).forEach(doc => doc.destroy())
})

describe.each([false, true])('粘贴有序列表连续编号（协作：%s）', collaborative => {
  it('接在现有列表后连续编号，重复粘贴仍保持一个列表，撤销/重做恢复完整结构', () => {
    const editor = createEditor([ordered(['原甲', '原乙'], 5), paragraph()], collaborative)
    const original = editor.getJSON()
    const html = copyList()
    pasteAtEnd(editor, html)
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ start: 5, diffId: original.content![0]!.attrs!.diffId })
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(1)
    expect(editor.state.doc.firstChild?.content.content.map(node => node.textContent)).toEqual(['原甲', '原乙', '复制甲', '复制乙'])
    expect(editor.state.doc.firstChild?.child(0).toJSON()).toEqual(original.content![0]!.content![0])
    const pasted = editor.getJSON()
    expect(draftDocumentSchema.safeParse(pasted).success).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(original)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(pasted)

    const manager = yUndoPluginKey.getState(editor.state)?.undoManager
    if (manager) manager.stopCapturing()
    else editor.view.dispatch(closeHistory(editor.state.tr))
    pasteAtEnd(editor, html)
    expect(editor.state.doc.firstChild?.childCount).toBe(6)
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(1)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(pasted)
  })

  it('粘贴到两段有序列表之间，前后均接续且列表项不合并为一行', () => {
    const editor = createEditor([ordered(['前一项']), paragraph(), ordered(['后一项'])], collaborative)
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1)
    editor.view.pasteHTML(copyList())
    expect(editor.state.doc.firstChild?.content.content.map(node => node.textContent)).toEqual(['前一项', '复制甲', '复制乙', '后一项'])
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(1)
  })
})

describe('有序列表的粘贴边界', () => {
  it.each([paragraph('中间正文'), paragraph(), { type: 'horizontalRule' }])('隔着正文块时保持独立编号：%j', separator => {
    const editor = createEditor([ordered(['原列表']), separator, paragraph()])
    pasteAtEnd(editor, copyList())
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(2)
  })

  it('不同编号样式以及无序列表不能被拼入数字列表', () => {
    const editor = createEditor([ordered(['字母编号'], 1, 'a'), paragraph()])
    pasteAtEnd(editor, copyList())
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(2)
    const bullet = createEditor([{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('无序项')] }] }, paragraph()])
    pasteAtEnd(bullet, copyList())
    expect(bullet.state.doc.content.content.map(node => node.type.name)).toEqual(['bulletList', 'orderedList', 'paragraph'])
  })

  it('嵌套列表只在同一父级接续，不串入外层编号', () => {
    const editor = createEditor([{ type: 'orderedList', content: [{ type: 'listItem', content: [
      paragraph('外层'), ordered(['内层原项']), paragraph(),
    ] }] }])
    let target = 0
    editor.state.doc.descendants((node, position) => { if (node.type.name === 'paragraph' && !node.content.size) target = position + 1 })
    editor.commands.setTextSelection(target)
    editor.view.pasteHTML(copyList())
    const item = editor.state.doc.firstChild!.firstChild!
    expect(editor.state.doc.firstChild?.childCount).toBe(1)
    expect(item.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(1)
    expect(item.child(1).childCount).toBe(3)
  })

  it('纯文本 Markdown 列表也接续现有有序列表', () => {
    const editor = createEditor([ordered(['原项']), paragraph()])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    const data = new DataTransfer()
    data.setData('text/plain', '1. 新甲\n2. 新乙')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(editor.state.doc.firstChild?.childCount).toBe(3)
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(1)
  })

  it('不修改与粘贴位置无关的列表，也不在普通输入时重新编号', () => {
    const editor = createEditor([ordered(['独立甲']), ordered(['独立乙']), paragraph('分隔'), paragraph()])
    const first = editor.getJSON().content!.slice(0, 2)
    pasteAtEnd(editor, copyList())
    expect(editor.getJSON().content!.slice(0, 2)).toEqual(first)
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('普通输入')
    expect(editor.state.doc.content.content.filter(node => node.type.name === 'orderedList')).toHaveLength(3)
  })

  it('远端接收合并结果后保持相同结构与 ID，不产生额外本地撤销步骤', () => {
    const source = createEditor([ordered(['原项']), paragraph()], true)
    const sourceDoc = docs.at(-1)!
    const remoteDoc = new Y.Doc()
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(sourceDoc))
    const remote = createEditor([paragraph()], true, remoteDoc)
    const original = source.getJSON()
    pasteAtEnd(source, copyList())
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(sourceDoc))
    expect(remote.getJSON()).toEqual(source.getJSON())
    expect(remote.state.doc.firstChild?.childCount).toBe(3)
    expect(remote.commands.undo()).toBe(false)
    source.commands.undo()
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(sourceDoc))
    expect(remote.getJSON()).toEqual(original)
  })
})
