// @vitest-environment happy-dom

import { Editor, type JSONContent } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import Highlight from '@tiptap/extension-highlight'
import StarterKit from '@tiptap/starter-kit'
import { AllSelection, NodeSelection } from '@tiptap/pm/state'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTypingMarks, TypingMarks } from '../../app/components/editor/typing-marks-extension'

const editors: Editor[] = []
const documents: Y.Doc[] = []
const marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'highlight' }]
const content: JSONContent = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '已有格式', marks }] },
  { type: 'paragraph', content: [{ type: 'text', text: '普通文字' }] },
] }

function createEditor(collaborative = false, value = content) {
  const doc = new Y.Doc()
  documents.push(doc)
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: collaborative ? false : {} }), Highlight, TypingMarks,
      ...(collaborative ? [Collaboration.configure({ document: doc })] : []),
    ],
    content: collaborative ? undefined : value,
  })
  editors.push(editor)
  if (collaborative) editor.chain().setMeta('addToHistory', false).setContent(value).run()
  editor.commands.setTextSelection(3)
  return editor
}

function type(editor: Editor, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text))
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  documents.splice(0).forEach(doc => doc.destroy())
  vi.restoreAllMocks()
})

describe.each([false, true])('停止输入格式继承（协作：%s）', collaborative => {
  it('一次退出所有格式，保留原文字、标题和选区，并且只影响后续输入', () => {
    const editor = createEditor(collaborative)
    const before = editor.getJSON()
    const selection = editor.state.selection.toJSON()
    const canUndo = editor.can().undo()
    const updates = vi.fn()
    editor.on('update', updates)

    expect(getTypingMarks(editor.state).map(mark => mark.type.name).sort()).toEqual(marks.map(mark => mark.type).sort())
    expect(editor.can().stopMarkInheritance()).toBe(true)
    expect(editor.state.storedMarks).toBeNull()
    expect(editor.commands.stopMarkInheritance()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(editor.can().undo()).toBe(canUndo)
    expect(updates).not.toHaveBeenCalled()
    expect(getTypingMarks(editor.state)).toEqual([])

    type(editor, '普通输入')
    type(editor, '继续')
    const heading = editor.getJSON().content![0]!
    expect(heading.type).toBe('heading')
    expect(heading.attrs?.level).toBe(2)
    expect(heading.content).toEqual([
      { ...before.content![0]!.content![0], text: '已有' },
      { type: 'text', text: '普通输入继续' },
      { ...before.content![0]!.content![0], text: '格式' },
    ])
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.redo()).toBe(true)
    expect(editor.getJSON().content![0]).toEqual(heading)
  })

  it('停止后可以重新开启单个格式，移动光标后重新按落点继承', () => {
    const editor = createEditor(collaborative)
    editor.commands.stopMarkInheritance()
    editor.commands.toggleBold()
    expect(getTypingMarks(editor.state).map(mark => mark.type.name)).toEqual(['bold'])
    type(editor, '新')
    expect(editor.getJSON().content![0]!.content![1]).toEqual({ type: 'text', text: '新', marks: [{ type: 'bold' }] })
    editor.commands.setTextSelection(2)
    expect(getTypingMarks(editor.state)).toHaveLength(marks.length)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(getTypingMarks(editor.state)).toEqual([])
  })
})

describe('输入格式边界', () => {
  it.each(['code', 'link'])('能退出 %s，移动到仍带格式的末尾后可以再次退出', name => {
    const mark = name === 'link' ? { type: name, attrs: { href: 'https://example.com' } } : { type: name }
    const editor = createEditor(false, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有格式', marks: [mark] }] }] })
    expect(getTypingMarks(editor.state).map(mark => mark.type.name)).toEqual([name])
    editor.commands.stopMarkInheritance()
    type(editor, '普通')
    expect(editor.getJSON().content![0]!.content![1]).toEqual({ type: 'text', text: '普通' })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(getTypingMarks(editor.state).map(mark => mark.type.name)).toEqual([name])
    editor.commands.stopMarkInheritance()
    expect(getTypingMarks(editor.state)).toEqual([])
  })

  it('空段落中主动开启的多个格式也可以一起退出', () => {
    const editor = createEditor(false, { type: 'doc', content: [{ type: 'paragraph' }] })
    editor.chain().toggleBold().toggleItalic().run()
    expect(getTypingMarks(editor.state)).toHaveLength(2)
    editor.commands.stopMarkInheritance()
    type(editor, '普通')
    expect(editor.getJSON().content![0]!.content).toEqual([{ type: 'text', text: '普通' }])
  })

  it('快捷键不清除文本选区、全选或节点选区的格式', () => {
    const editor = createEditor()
    const before = editor.getJSON()
    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(getTypingMarks(editor.state)).toEqual([])
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })

  it('只读与输入法组词期间不切换格式，也不修改正文', () => {
    const editor = createEditor()
    const before = editor.getJSON()
    editor.setEditable(false)
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    editor.setEditable(true)
    vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true)
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    expect(editor.state.storedMarks).toBeNull()
    expect(editor.getJSON()).toEqual(before)
  })

  it('没有行内格式的代码块不会被转换或修改', () => {
    const editor = createEditor(false, { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'const n = 1' }] }] })
    const before = editor.getJSON()
    expect(getTypingMarks(editor.state)).toEqual([])
    expect(editor.commands.stopMarkInheritance()).toBe(false)
    expect(editor.getJSON()).toEqual(before)
  })
})
