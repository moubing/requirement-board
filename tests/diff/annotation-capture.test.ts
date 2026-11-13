// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { afterEach, expect, it } from 'vitest'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { captureAnnotation, annotationRanges } from '../../app/components/editor/annotation-capture'

let editor: Editor
afterEach(() => editor?.destroy())
it('选择带 emoji、格式和硬换行的片段时双向坐标一致，不改正文与撤销栈', () => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, BlockId], content: { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [
    { type: 'text', text: '前😀' }, { type: 'text', text: '加粗', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: '后文' },
  ] }] } })
  editor.commands.setTextSelection({ from: 2, to: 9 })
  const original = editor.getJSON(), undo = editor.can().undo()
  const note = captureAnnotation(editor)
  expect(note.quote).toBe('😀加粗\n后文')
  expect(note.segments[0]).toMatchObject({ start: 1, end: 7, topLevelId: 'p1' })
  const ranges = annotationRanges(editor, note.segments)
  expect(ranges).toHaveLength(1)
  expect(ranges[0]!.startContainer.textContent).toBe('前😀')
  expect(ranges[0]!.startOffset).toBe(1)
  expect(editor.getJSON()).toEqual(original)
  expect(editor.can().undo()).toBe(undo)
})
it('拒绝空选区及包含表格的跨块选区，不静默丢掉不支持的部分', () => {
  editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, BlockId, TableKit], content: '<p data-diff-id="start">开始</p><table><tbody><tr><td><p>单元格</p></td></tr></tbody></table><p data-diff-id="end">结束</p>' })
  expect(() => captureAnnotation(editor)).toThrow('先选中')
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 })
  expect(() => captureAnnotation(editor)).toThrow('表格')
})
