// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { TableKit } from '@tiptap/extension-table'
import { closeHistory } from '@tiptap/pm/history'
import StarterKit from '@tiptap/starter-kit'
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockId, Callout, ImageCaption, RequirementImage } from '../../app/components/editor/tiptap-extensions'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import { type RichTextDocument } from '../../shared/editor/document'

vi.mock('../../app/components/editor/RequirementImageNode.vue', () => ({ default: {} }))
vi.mock('../../app/components/editor/RequirementCalloutNode.vue', () => ({ default: {} }))

const editors: Editor[] = []
const documents: Y.Doc[] = []
const initialContent: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { diffId: 'para_initial' }, content: [{ type: 'text', text: '开始正文' }] }],
}

function createEditor(collaborative: boolean, sharedDoc?: Y.Doc) {
  const doc = sharedDoc ?? createCollaborationDocument({ title: '测试', contentJson: structuredClone(initialContent) })
  documents.push(doc)
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: collaborative ? false : {} }),
      BlockId, RequirementImage, ImageCaption, Callout, TableKit,
      ...(collaborative ? [Collaboration.configure({ document: doc })] : []),
    ],
    content: collaborative ? undefined : initialContent,
  })
  editors.push(editor)
  editor.commands.setTextSelection(3)
  return editor
}

function separateHistory(editor: Editor) {
  const manager = yUndoPluginKey.getState(editor.state)?.undoManager
  if (manager) manager.stopCapturing()
  else editor.view.dispatch(closeHistory(editor.state.tr))
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  documents.splice(0).forEach(doc => doc.destroy())
})

describe.each([false, true])('编辑器结构撤销（协作：%s）', collaborative => {
  const cases: [string, (editor: Editor) => unknown][] = [
    ['拆分段落', editor => editor.commands.splitBlock()],
    ['有序列表', editor => editor.commands.toggleOrderedList()],
    ['无序列表', editor => editor.commands.toggleBulletList()],
    ['引用', editor => editor.commands.toggleBlockquote()],
    ['标题', editor => editor.commands.toggleHeading({ level: 2 })],
    ['代码块', editor => editor.commands.toggleCodeBlock()],
    ['提示块', editor => editor.commands.insertCallout({ text: '提示' })],
    ['表格', editor => editor.commands.insertTable({ rows: 2, cols: 2 })],
    ['分隔线', editor => editor.commands.setHorizontalRule()],
    ['图片及段落拆分', editor => editor.commands.insertContent({
      type: 'image', attrs: { src: '/uploads/test.png', diffId: 'image_inserted' },
      content: [{ type: 'imageCaption' }],
    })],
  ]

  it.each(cases)('%s 能完整撤销并重做，包含稳定的块 ID', (_name, change) => {
    const editor = createEditor(collaborative)
    const before = editor.getJSON()
    change(editor)
    const after = editor.getJSON()
    expect(after).not.toEqual(before)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(after)
  })

  it.each(['paragraph', 'orderedList', 'bulletList'])('%s 清空输入后还能继续撤销新增块', type => {
    const editor = createEditor(collaborative)
    if (type === 'orderedList') editor.commands.toggleOrderedList()
    if (type === 'bulletList') editor.commands.toggleBulletList()
    const before = editor.getJSON()
    separateHistory(editor)
    if (type === 'paragraph') editor.commands.splitBlock()
    else editor.commands.splitListItem('listItem')
    const split = editor.getJSON()
    separateHistory(editor)
    editor.commands.insertContent('后来输入')
    const typed = editor.getJSON()

    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(split)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(split)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(typed)
  })

  it('图片插入后继续输入，能依次撤销输入和图片，再完整重做', () => {
    const editor = createEditor(collaborative)
    const before = editor.getJSON()
    editor.commands.insertContent({
      type: 'image', attrs: { src: '/uploads/test.png', diffId: 'image_uploaded' },
      content: [{ type: 'imageCaption' }],
    })
    const inserted = editor.getJSON()
    separateHistory(editor)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('图片之后')
    const typed = editor.getJSON()
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(inserted)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON()).toEqual(typed)
  })

  it.each(['paragraph', 'codeBlock'])('明确排除历史的外部 %s 及其 ID 修正仍不进入撤销栈', type => {
    const editor = createEditor(collaborative)
    editor.chain().setMeta('addToHistory', false).setContent({ type: 'doc', content: [{
      type, content: [{ type: 'text', text: '外部内容' }],
    }] }).run()
    const external = editor.getJSON()
    expect(editor.can().undo()).toBe(false)
    editor.commands.insertContent('本地输入')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(external)
  })

  it('一系列结构修改可以撤销到底并多次重做，之后新输入清空重做分支', () => {
    const editor = createEditor(collaborative)
    const before = editor.getJSON()
    const changes = [
      () => editor.commands.splitBlock(),
      () => editor.commands.insertContent('段落文字'),
      () => editor.commands.toggleOrderedList(),
      () => editor.commands.splitListItem('listItem'),
      () => editor.commands.insertContent('第二项'),
      () => editor.commands.toggleBold(),
      () => editor.commands.insertContent('加粗文字'),
    ]
    for (const change of changes) { separateHistory(editor); change() }
    const after = editor.getJSON()
    for (let round = 0; round < 2; round++) {
      let undoCount = 0
      while (editor.can().undo() && undoCount++ < 20) editor.commands.undo()
      expect(editor.getJSON()).toEqual(before)
      expect(undoCount).toBeLessThan(20)
      let redoCount = 0
      while (editor.can().redo() && redoCount++ < 20) editor.commands.redo()
      expect(editor.getJSON()).toEqual(after)
    }
    editor.commands.undo()
    editor.commands.insertContent('新的分支')
    expect(editor.can().redo()).toBe(false)
  })
})

it('本地结构撤销、重做与远端输入合并，保留远端文字和块 ID', () => {
  const a = createEditor(true)
  const aDoc: Y.Doc = ySyncPluginKey.getState(a.state).doc
  const bDoc = new Y.Doc()
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc))
  const b = createEditor(true, bDoc)
  a.commands.splitBlock()
  const insertedId = a.state.doc.lastChild!.attrs.diffId
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc))
  b.commands.insertContentAt(1, '远端')
  Y.applyUpdate(aDoc, Y.encodeStateAsUpdate(bDoc))
  a.commands.undo()
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc))
  expect(a.getJSON()).toEqual(b.getJSON())
  expect(a.state.doc.textContent).toBe('远端开始正文')
  expect(a.state.doc.childCount).toBe(1)
  a.commands.redo()
  Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc))
  expect(a.getJSON()).toEqual(b.getJSON())
  expect(a.state.doc.textContent).toBe('远端开始正文')
  expect(a.state.doc.lastChild!.attrs.diffId).toBe(insertedId)
})
