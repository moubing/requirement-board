// @vitest-environment happy-dom

import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { ScrollbarCodeBlock, ScrollbarTableView } from '../../app/components/editor/scrollbar-node-views'

const editors: Editor[] = []
const apps: App[] = []
async function createEditor(editable = true) {
  const element = document.body.appendChild(document.createElement('div'))
  const editor = new Editor({
    editable,
    extensions: [StarterKit.configure({ codeBlock: false }), ScrollbarCodeBlock,
      TableKit.configure({ table: { View: ScrollbarTableView } }), BlockId],
    content: { type: 'doc', content: [
      { type: 'codeBlock', attrs: { diffId: 'code-one', language: 'js' }, content: [{ type: 'text', text: 'const count = 1' }] },
      { type: 'paragraph', attrs: { diffId: 'paragraph-one' } },
    ] },
  })
  editors.push(editor)
  const app = createApp({ render: () => h(EditorContent, { editor }) })
  app.mount(element)
  apps.push(app)
  await nextTick()
  await nextTick()
  return editor
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  editors.splice(0).forEach(editor => editor.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('正文滚动 NodeView', () => {
  it('在 Vue 渲染上下文外创建和销毁表格、代码块时，组件 ref 有所属实例', async () => {
    const warn = vi.spyOn(console, 'warn')
    const editor = await createEditor()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await nextTick()
    expect(editor.view.dom.querySelectorAll('.bing-scrollbar')).toHaveLength(2)
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
    await nextTick()
    expect(editor.view.dom.querySelectorAll('.bing-scrollbar')).toHaveLength(0)
    expect(warn.mock.calls.flat().map(String).join('\n')).not.toContain('Missing ref owner context')
  })

  it('保留代码输入、撤销、语言和 diffId，滚动条不进入 JSON/HTML', async () => {
    const editor = await createEditor()
    const original = editor.getJSON()
    editor.commands.setTextSelection(1)
    editor.commands.insertContent('// comment\n')
    await nextTick()
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('// comment\nconst count = 1')
    expect(editor.view.dom.querySelector('pre code')?.classList.contains('language-js')).toBe(true)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(original)
    expect(editor.getHTML()).toContain('data-diff-id="code-one"')
    expect(editor.getHTML()).not.toContain('bing-scrollbar')
    editor.commands.setTextSelection(1)
    editor.commands.toggleCodeBlock()
    expect(editor.getJSON().content?.[0]?.type).toBe('paragraph')
    expect(editor.view.dom.querySelector('.requirement-code-block')).toBeNull()
  })

  it('只读视图可选择正文，滚动包装不会改写历史快照', async () => {
    const editor = await createEditor(false)
    const original = editor.getJSON()
    editor.commands.setTextSelection({ from: 1, to: 6 })
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('const')
    expect(editor.isEditable).toBe(false)
    expect(editor.getJSON()).toEqual(original)
    editor.destroy()
    editors.pop()
    expect(document.querySelector('.bing-scrollbar')).toBeNull()
  })
})
