// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { captureAnnotation } from '../../app/components/editor/annotation-capture'
import { ANNOTATION_EDIT_EXTERNAL, createAnnotationEditGuard } from '../../app/components/editor/annotation-edit-guard'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import type { AiAnnotation } from '../../shared/agent/annotations'
import type { RichTextDocument } from '../../shared/editor/document'

const content: RichTextDocument = { type: 'doc', content: [
  { type: 'paragraph', attrs: { diffId: 'first' }, content: [{ type: 'text', text: '前文😀需要确认的文字，后文继续保留。' }] },
  { type: 'paragraph', attrs: { diffId: 'second' }, content: [{ type: 'text', text: '另一段可以自由编辑。' }] },
] }
const editors: Editor[] = [], documents: Y.Doc[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); documents.splice(0).forEach(doc => doc.destroy()) })

function setup(collaborative = false) {
  const notes: AiAnnotation[] = []
  const request = vi.fn(), remove = vi.fn((ids: string[]) => {
    for (let index = notes.length - 1; index >= 0; index--) if (ids.includes(notes[index]!.id)) notes.splice(index, 1)
  }), stale = vi.fn(), update = vi.fn()
  const guard = createAnnotationEditGuard({ enabled: () => true, annotations: () => notes, request, remove, stale })
  const doc = createCollaborationDocument({ title: '标注确认', contentJson: structuredClone(content) })
  documents.push(doc)
  const editor = new Editor({ element: document.createElement('div'), content: collaborative ? undefined : content,
    extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId, guard.extension,
      ...(collaborative ? [Collaboration.configure({ document: doc })] : [])], onUpdate: update })
  editors.push(editor)
  editor.commands.setTextSelection({ from: 3, to: 12 })
  const note = { ...captureAnnotation(editor), comment: '修改要求' }
  notes.push(note)
  editor.commands.setTextSelection(7)
  update.mockClear()
  request.mockClear()
  return { editor, notes, note, guard, request, remove, stale, update, doc }
}

it('拒绝修改后取消，正文、选区、更新事件和撤销栈完全不变', async () => {
  const { editor, guard, request, remove, notes, update } = setup()
  const before = editor.getJSON(), selection = editor.state.selection.toJSON(), history = editor.can().undo()
  editor.commands.insertContent('新增')
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith([notes[0]!.id]))
  expect(editor.getJSON()).toEqual(before)
  expect(update).not.toHaveBeenCalled()
  guard.cancel()
  expect(editor.getJSON()).toEqual(before)
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(editor.can().undo()).toBe(history)
  expect(remove).not.toHaveBeenCalled()
  expect(notes).toHaveLength(1)
})

it.each([false, true])('确认后只应用一次输入并可撤销，确认前不写 Yjs（协作：%s）', async collaborative => {
  const { editor, guard, request, notes, update, doc } = setup(collaborative)
  const before = editor.getJSON(), vector = Y.encodeStateVector(doc)
  const transaction = editor.state.tr.insertText('确认输入')
  const expected = transaction.doc.toJSON()
  editor.view.dispatch(transaction)
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith([notes[0]!.id]))
  expect(editor.getJSON()).toEqual(before)
  expect(Y.encodeStateVector(doc)).toEqual(vector)
  expect(update).not.toHaveBeenCalled()
  guard.confirm()
  guard.confirm()
  expect(editor.getJSON()).toEqual(expected)
  expect(notes).toEqual([])
  expect(update).toHaveBeenCalledTimes(1)
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(before)
  expect(notes).toEqual([])
  expect(editor.commands.redo()).toBe(true)
  expect(editor.getJSON()).toEqual(expected)
})

it.each(['删除', '替换', '拆段'])('%s 修改先确认，取消不保留任何内容变化', async operation => {
  const { editor, guard, request, notes } = setup()
  const before = editor.getJSON()
  if (operation === '删除') editor.view.dispatch(editor.state.tr.delete(6, 8))
  else if (operation === '替换') editor.commands.insertContentAt({ from: 6, to: 8 }, '粘贴文字')
  else editor.commands.splitBlock()
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith([notes[0]!.id]))
  expect(editor.getJSON()).toEqual(before)
  guard.cancel()
  expect(editor.getJSON()).toEqual(before)
})

it('一次修改仅清除受影响的标注，无关段落和纯格式编辑不提示', async () => {
  const { editor, guard, request, notes, note, remove } = setup()
  editor.commands.setTextSelection({ from: 5, to: 10 })
  notes.push({ ...captureAnnotation(editor), comment: '重叠要求' })
  const affected = notes.map(note => note.id)
  const secondStart = editor.state.doc.child(0).nodeSize + 1
  editor.commands.setTextSelection({ from: secondStart, to: secondStart + 3 })
  notes.push({ ...captureAnnotation(editor), comment: '保留要求' })
  editor.commands.setTextSelection({ from: 5, to: 10 })
  editor.commands.toggleBold()
  expect(request).not.toHaveBeenCalled()
  editor.commands.setTextSelection(7)
  editor.commands.insertContent('影响两个标注')
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith(affected))
  guard.confirm()
  expect(remove).toHaveBeenCalledWith(affected)
  expect(notes).toHaveLength(1)
  expect(notes[0]!.id).not.toBe(note.id)
  request.mockClear()
  editor.commands.insertContent('继续输入不再提示')
  expect(request).not.toHaveBeenCalled()
})

it('其他段落的编辑与新块 ID 修复不会使标注弹出确认', () => {
  const { editor, request, notes } = setup()
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  editor.commands.insertContent('自由编辑')
  editor.commands.splitBlock()
  expect(request).not.toHaveBeenCalled()
  expect(notes).toHaveLength(1)
})

it('等待确认时收到真实协作更新，取消待处理输入，不阻断同步或重放过期事务', async () => {
  const { editor, guard, request, notes, doc, stale, remove } = setup(true)
  editor.commands.insertContent('尚未确认')
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith([notes[0]!.id]))
  const peerDoc = new Y.Doc()
  documents.push(peerDoc)
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(doc))
  const peer = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), BlockId, Collaboration.configure({ document: peerDoc })] })
  editors.push(peer)
  peer.commands.insertContentAt(1, '远端修改')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peerDoc))
  const remote = editor.getJSON()
  expect(editor.getText()).toContain('远端修改')
  expect(stale).toHaveBeenCalledTimes(1)
  guard.confirm()
  expect(editor.getJSON()).toEqual(remote)
  expect(remove).not.toHaveBeenCalled()
  expect(notes).toHaveLength(1)
})

it('外部正文装载保留既有失效提示，不清除本机标注', () => {
  const { editor, request, notes } = setup()
  editor.view.dispatch(editor.state.tr.insertText('外部修改').setMeta(ANNOTATION_EDIT_EXTERNAL, true))
  expect(editor.getText()).toContain('外部修改')
  expect(request).not.toHaveBeenCalled()
  expect(notes).toHaveLength(1)
})

it('输入法在开始组词时确认，取消无候选残留，确认不插入中间拼音', async () => {
  const { editor, guard, request, notes, update } = setup()
  const before = editor.getJSON()
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  editor.view.dispatch(editor.state.tr.insertText('zhongwen').setMeta('composition', 1))
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith([notes[0]!.id]))
  expect(editor.getJSON()).toEqual(before)
  expect(update).not.toHaveBeenCalled()
  guard.cancel()
  expect(notes).toHaveLength(1)
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  guard.confirm()
  expect(notes).toHaveLength(0)
  expect(editor.getJSON()).toEqual(before)
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  editor.commands.insertContent('中文')
  expect(editor.getText()).toContain('中文')
  expect(editor.getText()).not.toContain('zhongwen')
})

it('卸载取消尚未显示的确认，不能迟到删除标注或派发事务', async () => {
  const { editor, guard, request, remove, notes } = setup()
  editor.commands.insertContent('待确认')
  editor.destroy()
  await new Promise(resolve => setTimeout(resolve, 10))
  guard.confirm()
  expect(request.mock.calls.every(([ids]) => ids === null)).toBe(true)
  expect(remove).not.toHaveBeenCalled()
  expect(notes).toHaveLength(1)
})
