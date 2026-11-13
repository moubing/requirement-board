// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createSlashCommands, type SlashMenuState } from '../../app/components/editor/slash-command-extension'
import { slashRangeAt } from '../../app/components/editor/slash-commands'
import { imageUploadPlaceholderPluginKey } from '../../app/components/editor/image-upload-placeholder'
import { BlockId, Callout, ImageCaption, RequirementImage } from '../../app/components/editor/tiptap-extensions'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import type { RichTextDocument } from '../../shared/editor/document'
import { RequirementTaskList, RequirementTaskItem } from '../../shared/editor/task-list'
import { EditableDetails, EditableDetailsContent, RequirementDetailsSummary } from '../../app/components/editor/details-extension'

vi.mock('../../app/components/editor/RequirementImageNode.vue', () => ({ default: {} }))
vi.mock('../../app/components/editor/RequirementCalloutNode.vue', () => ({ default: {} }))
const editors: Editor[] = []
const docs: Y.Doc[] = []
function setup(collaborative: boolean, text = '') {
  const content: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'original' }, ...(text ? { content: [{ type: 'text', text }] } : {}) }] }
  const doc = createCollaborationDocument({ title: '', contentJson: content })
  docs.push(doc)
  let menu: SlashMenuState | null = null
  let enabled = true
  const pickImage = vi.fn()
  const slash = createSlashCommands({ enabled: () => enabled, update: state => { menu = state }, pickImage })
  const editor = new Editor({
    content: collaborative ? undefined : content,
    extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), TableKit, BlockId, Callout, RequirementImage, ImageCaption, RequirementTaskList, RequirementTaskItem,
      EditableDetails, EditableDetailsContent, RequirementDetailsSummary,
      slash.extension, ...(collaborative ? [Collaboration.configure({ document: doc })] : [])],
  })
  editors.push(editor)
  editor.commands.setTextSelection(text.length + 1)
  function type(value: string) {
    for (const char of value) {
      const { from, to } = editor.state.selection
      const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char)))
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char))
    }
  }
  function key(key: string) { return editor.view.someProp('handleKeyDown', handler => handler(editor.view, new KeyboardEvent('keydown', { key }))) }
  function composition(type: 'compositionstart' | 'compositionend') {
    editor.view.someProp('handleDOMEvents', handlers => handlers[type]?.(editor.view, new CompositionEvent(type)))
  }
  return { editor, doc, slash, type, key, composition, pickImage, menu: () => menu, disable: () => { enabled = false; slash.close() } }
}
afterEach(() => { editors.splice(0).forEach(e => e.destroy()); docs.splice(0).forEach(d => d.destroy()); vi.restoreAllMocks() })

describe.each([false, true])('斜杠命令（协作=%s）', collaborative => {
  it.each(['h1', 'h2', 'h3', 'ul', 'ol', 'task', 'quote', 'note', 'tip', 'warning', 'danger', 'code', 'details', 'hr', 'table', '正文'])('%s 插入与触发/筛选同一步撤销，前后输入独立', alias => {
    const f = setup(collaborative)
    f.type('前文 ')
    const before = f.editor.getJSON()
    f.type('/')
    expect(f.menu()).not.toBeNull()
    const time = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    f.type(alias)
    expect(f.menu()?.items.length).toBeGreaterThan(0)
    f.key('Enter')
    const inserted = f.editor.getJSON()
    expect(f.menu()).toBeNull()
    expect(JSON.stringify(inserted)).not.toContain(`/${alias}`)
    time.mockRestore()
    if (alias === '正文') { expect(inserted).toEqual(before); return }
    expect(f.editor.commands.undo()).toBe(true)
    expect(f.editor.getJSON()).toEqual(before)
    expect(f.editor.commands.redo()).toBe(true)
    expect(f.editor.getJSON()).toEqual(inserted)
  })
  it('全角斜杠和段首顿号触发，段中顿号和路径不触发', () => {
    for (const [prefix, trigger, expected] of [['', '／', true], ['', '、', true], ['文字 ', '／', true], ['文字 ', '、', false], [' ', '、', false], ['https:', '/', false]] as const) {
      const f = setup(collaborative, prefix)
      f.type(trigger)
      expect(Boolean(f.menu()), `${prefix}${trigger}`).toBe(expected)
    }
  })
  it('取消、删除、移动光标、无匹配与只读均不执行插入', () => {
    const f = setup(collaborative)
    f.type('/不存在的命令')
    const before = f.editor.getJSON()
    f.key('Enter')
    expect(f.menu()?.items).toHaveLength(0)
    expect(f.editor.getJSON()).toEqual(before)
    f.key('Escape')
    f.type('更多')
    expect(f.menu()).toBeNull()
    expect(f.editor.getText()).toBe('/不存在的命令更多')
    f.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
    f.type('/')
    f.editor.commands.deleteRange({ from: 1, to: 2 })
    expect(f.menu()).toBeNull()
    f.type('/h1')
    f.editor.commands.setTextSelection(1)
    expect(f.menu()).toBeNull()
    f.disable()
    f.type('/')
    expect(f.menu()).toBeNull()
  })
  it('代码/题注不触发，单元格内不允许嵌套表格', () => {
    const f = setup(collaborative)
    f.editor.commands.setCodeBlock()
    f.type('/')
    expect(slashRangeAt(f.editor.state)).toBeNull()
    expect(f.menu()).toBeNull()
    f.editor.commands.setContent({ type: 'doc', content: [
      { type: 'image', attrs: { src: '/uploads/test.png' }, content: [{ type: 'imageCaption' }] },
      { type: 'paragraph' },
    ] })
    f.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'imageCaption') f.editor.commands.setTextSelection(pos + 1) })
    f.type('/')
    expect(f.menu()).toBeNull()
    f.editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
    f.editor.commands.insertTable({ rows: 3, cols: 3 })
    f.type('/')
    expect(f.menu()?.items.some(item => item.id === 'table')).toBe(false)
    expect(f.menu()?.items.some(item => item.id === 'h1')).toBe(true)
  })
  it('图片取消保留输入，文件选择前不删除命令', () => {
    const f = setup(collaborative)
    f.type('/image')
    f.key('Tab')
    expect(f.pickImage).toHaveBeenCalledOnce()
    expect(f.editor.getText()).toBe('/image')
    f.editor.view.dispatch(f.editor.state.tr)
    expect(f.menu()).toBeNull()
    expect(f.slash.isPickingImage()).toBe(true)
    f.slash.close()
    expect(f.editor.getText()).toBe('/image')
  })
  it('组词期间冻结已有菜单和选中项，候选选区变化不关闭，提交后更新筛选并可单步撤销', async () => {
    const f = setup(collaborative)
    const before = f.editor.getJSON()
    f.type('/')
    f.slash.move(2)
    const menu = f.menu()
    f.composition('compositionstart')
    f.type('biao')
    f.editor.commands.setTextSelection({ from: 2, to: 6 })
    f.slash.move(5)
    expect(f.menu()).toBe(menu)
    expect(f.slash.select(0)).toBe(false)
    expect(f.editor.getText()).toBe('/biao')
    f.editor.view.dispatch(f.editor.state.tr.insertText('表格', 2, 6))
    f.composition('compositionend')
    await vi.waitFor(() => expect(f.menu()?.items.map(item => item.id)).toEqual(['table']))
    f.key('Enter')
    expect(f.editor.getJSON().content?.[0]?.type).toBe('table')
    f.editor.commands.undo()
    expect(f.editor.getJSON()).toEqual(before)
  })
  it('取消组词恢复原菜单；组词期间关闭菜单后，迟到的 compositionend 不重开', async () => {
    const f = setup(collaborative)
    f.type('/图')
    f.composition('compositionstart')
    f.type('pian')
    f.editor.commands.deleteRange({ from: 3, to: 7 })
    f.composition('compositionend')
    await vi.waitFor(() => expect(f.menu()?.range.query).toBe('图'))
    expect(f.menu()?.items.map(item => item.id)).toEqual(['image'])
    f.composition('compositionstart')
    f.disable()
    f.composition('compositionend')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(f.menu()).toBeNull()
    expect(f.editor.getText()).toBe('/图')
  })
  it('菜单选择与关闭不写正文或协作状态', () => {
    const f = setup(collaborative)
    f.type('/')
    const before = f.editor.getJSON()
    const binary = Y.encodeStateAsUpdate(f.doc)
    f.slash.move(4); f.slash.move(12); f.slash.close()
    expect(f.editor.getJSON()).toEqual(before)
    expect(Y.encodeStateAsUpdate(f.doc)).toEqual(binary)
  })
  it('图片上传完成后一次撤销恢复命令前，后续输入不合并', () => {
    const f = setup(collaborative)
    f.type('前文 ')
    const before = f.editor.getJSON()
    f.type('/image'); f.key('Enter')
    expect(f.slash.imagePicked('task')).toBe(true)
    f.slash.insertImage('task', () => f.editor.chain().setMeta(imageUploadPlaceholderPluginKey, { type: 'insert', id: 'task', imageDiffId: 'image' })
      .insertContent({ type: 'image', attrs: { diffId: 'image', src: '/uploads/test.png' }, content: [{ type: 'imageCaption' }] }).run())
    f.slash.imageFinished('task')
    expect(f.editor.commands.undo()).toBe(true)
    expect(f.editor.getJSON()).toEqual(before)
  })
})

it('协作者修改使菜单关闭，个人撤销仍保留远端输入', () => {
  const f = setup(true)
  f.type('/h1')
  const peer = new Y.Doc(); docs.push(peer)
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(f.doc))
  const text = (peer.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText
  text.insert(0, '远端 ')
  Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(peer))
  expect(f.menu()).toBeNull()
  f.editor.commands.undo()
  expect(f.editor.getText()).toBe('远端 ')
})
