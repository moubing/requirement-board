// @vitest-environment happy-dom

import { Editor, type JSONContent } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TableKit } from '@tiptap/extension-table'
import { CellSelection } from '@tiptap/pm/tables'

import { BlockId, EditorClipboard, ImageCaption, MarkdownPaste, RequirementImage } from '../../app/components/editor/tiptap-extensions'
import { richTextDocumentSchema } from '../../shared/editor/validation'

vi.mock('../../app/components/editor/RequirementImageNode.vue', () => ({ default: {} }))
vi.mock('../../app/components/editor/RequirementCalloutNode.vue', () => ({ default: {} }))

const editors: Editor[] = []
function createEditor(content?: JSONContent) {
  const editor = new Editor({
    enablePasteRules: false,
    extensions: [StarterKit, BlockId, EditorClipboard, Markdown, MarkdownPaste, RequirementImage, ImageCaption, TableKit],
    content: content ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'empty' } }] },
  })
  editors.push(editor)
  return editor
}

const paragraph = (text: string, diffId: string): JSONContent => ({
  type: 'paragraph', attrs: { diffId }, content: text ? [{ type: 'text', text }] : undefined,
})
const listAndParagraph: JSONContent = {
  type: 'doc', content: [
    { type: 'orderedList', attrs: { diffId: 'list_original', start: 3 }, content: [
      { type: 'listItem', attrs: { diffId: 'item_original' }, content: [paragraph('列表内容', 'para_item')] },
    ] },
    paragraph('下面的一句话', 'para_sentence'),
  ],
}

function pasteText(editor: Editor, text: string) {
  const data = new DataTransfer()
  data.setData('text/plain', text)
  editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}

afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('编辑器复制与粘贴', () => {
  it('系统剪贴板 HTML 包装的空白不进入正文成为软换行', () => {
    const editor = createEditor()
    editor.view.pasteHTML('<html>\r\n<body>\r\n<!--StartFragment--><p data-pm-slice="1 1 []">复制的一句话</p><!--EndFragment-->\r\n</body>\r\n</html>')
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.toJSON().content).toEqual([{ type: 'text', text: '复制的一句话' }])
  })

  it('Windows HTML 粘入已有段落时不在文字前后各加入两个 hardBreak', () => {
    const editor = createEditor({ type: 'doc', content: [paragraph('前后', 'original')] })
    editor.commands.setTextSelection(2)
    editor.view.pasteHTML('<html>\r\n<body>\r\n<!--StartFragment--><p data-pm-slice="1 1 []">复制内容</p><!--EndFragment-->\r\n</body>\r\n</html>')
    expect(editor.state.doc.firstChild?.toJSON().content).toEqual([{ type: 'text', text: '前复制内容后' }])
  })

  it('移除剪贴板包装时保留片段里的真实软换行和代码空白', () => {
    const editor = createEditor()
    editor.view.pasteHTML('<html>\r\n<body>\r\n<!--StartFragment--><p data-pm-slice="0 0 []"><br>正文<br><br>下一行</p><pre><code>  code\n\n</code></pre><!--EndFragment-->\r\n</body>\r\n</html>')
    expect(editor.state.doc.firstChild?.toJSON().content).toEqual([
      { type: 'hardBreak' }, { type: 'text', text: '正文' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'text', text: '下一行' },
    ])
    expect(editor.state.doc.child(1).textContent).toBe('  code\n\n')
  })

  it('外部 HTML 的片段祖先仍可提供加粗等格式', () => {
    const editor = createEditor()
    editor.view.pasteHTML('<html><body><strong><!--StartFragment-->外部文字<!--EndFragment--></strong></body></html>')
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  })

  it.each([
    '<span data-image-caption-content>保留题注</span>',
    '<figure data-requirement-image><figcaption><span data-image-caption-content>保留题注</span></figcaption></figure>',
    '<figure data-requirement-image><img src=""><figcaption><span data-image-caption-content>保留题注</span></figcaption></figure>',
    '<figure data-requirement-image><img src="  "><figcaption><span data-image-caption-content>保留题注</span></figcaption></figure>',
    '<figure data-requirement-image><img src="data:image/png;base64,AA=="><figcaption><span data-image-caption-content>保留题注</span></figcaption></figure>',
  ])('粘贴不完整图片 HTML 不生成地址为空的图片：%s', html => {
    const editor = createEditor()
    editor.view.pasteHTML(html)
    expect(editor.state.doc.textContent).toBe('保留题注')
    expect(richTextDocumentSchema.safeParse(editor.getJSON()).success).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph')
  })

  it.each([false, true])('跨列表和段落复制后，富文本粘贴不增加首尾空段落（系统包装：%s）', wrapped => {
    const source = createEditor(listAndParagraph)
    source.commands.setTextSelection({ from: 3, to: source.state.doc.content.size - 1 })
    const copied = source.view.serializeForClipboard(source.state.selection.content())
    const target = createEditor()
    const html = wrapped ? `<html>\r\n<body>\r\n<!--StartFragment-->${copied.dom.innerHTML}<!--EndFragment-->\r\n</body>\r\n</html>` : copied.dom.innerHTML
    expect(target.view.pasteHTML(html)).toBe(true)
    expect(target.state.doc.childCount).toBe(2)
    expect(target.state.doc.child(0).type.name).toBe('orderedList')
    expect(target.state.doc.child(0).attrs.start).toBe(3)
    expect(target.state.doc.child(1).textContent).toBe('下面的一句话')
  })

  it('粘贴含 HTML 的富文本不被纯文本中的 Markdown 语法抢占', () => {
    const editor = createEditor()
    const data = new DataTransfer()
    data.setData('text/html', '<p><strong>**字面文本**</strong></p>')
    data.setData('text/plain', '**字面文本**')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    expect(editor.getText()).toBe('**字面文本**')
    expect(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
  })

  it('粘贴到代码块保留 Markdown 原文', () => {
    const editor = createEditor({ type: 'doc', content: [{ type: 'codeBlock', attrs: { diffId: 'code' } }] })
    pasteText(editor, '# 原样粘贴\n\n**不要加粗**')
    // StarterKit 在末尾代码块后提供一个可继续输入的段落。
    expect(editor.state.doc.content.content.map(node => node.type.name)).toEqual(['codeBlock', 'paragraph'])
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock')
    expect(editor.state.doc.firstChild?.textContent).toBe('# 原样粘贴\n\n**不要加粗**')
  })

  it('复制段落到原段落之前时保留原块 ID', () => {
    const editor = createEditor({ type: 'doc', content: [paragraph('原段落', 'para_original')] })
    editor.commands.selectAll()
    const copied = editor.view.serializeForClipboard(editor.state.selection.content())
    editor.commands.setTextSelection(1)
    editor.view.pasteHTML(copied.dom.innerHTML)
    const ids: string[] = []
    editor.state.doc.descendants(node => { if (node.attrs.diffId) ids.push(node.attrs.diffId) })
    expect(new Set(ids).size).toBe(ids.length)
    expect(editor.state.doc.lastChild?.attrs.diffId).toBe('para_original')
  })

  it.each(['orderedList', 'bulletList'])('%s 全选复制的纯文本不从容器生成首尾或重复空行', type => {
    const content = structuredClone(listAndParagraph)
    content.content![0]!.type = type
    const editor = createEditor(content)
    editor.commands.selectAll()
    const copied = editor.view.serializeForClipboard(editor.state.selection.content())
    expect(copied.text).toBe('列表内容\n下面的一句话')
  })

  it('复制保留真实空段落、软换行、代码缩进与末尾空行', () => {
    const editor = createEditor({ type: 'doc', content: [
      paragraph('', 'empty_start'),
      { type: 'paragraph', content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
      paragraph('', 'empty_middle'),
      { type: 'codeBlock', content: [{ type: 'text', text: '  code\n    indented' }] },
      paragraph('', 'empty_end'),
    ] })
    editor.commands.selectAll()
    const copied = editor.view.serializeForClipboard(editor.state.selection.content())
    expect(copied.text).toBe('\n第一行\n第二行\n\n  code\n    indented\n')
  })

  it('只复制选中的表格列，不带入中间未选中的单元格', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [paragraph(text, text)] })
    const editor = createEditor({ type: 'doc', content: [{ type: 'table', content: [
      { type: 'tableRow', content: [cell('甲'), cell('不选一')] },
      { type: 'tableRow', content: [cell('乙'), cell('不选二')] },
    ] }] })
    const cells: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[2], cells[0])))
    expect(editor.view.serializeForClipboard(editor.state.selection.content()).text).toBe('甲\n乙')
  })

  it('只有纯文本的 Markdown 仍转换列表和格式，并正确合并粘贴边界', () => {
    const editor = createEditor()
    pasteText(editor, '1. **列表内容**\n\n下面的一句话')
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild?.type.name).toBe('orderedList')
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
    expect(editor.state.doc.lastChild?.textContent).toBe('下面的一句话')
  })

  it('Ctrl+Shift+V 粘贴纯文本不触发 Markdown', () => {
    const editor = createEditor()
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }))
    pasteText(editor, '**保留星号**')
    expect(editor.state.doc.textContent).toBe('**保留星号**')
    expect(editor.state.doc.firstChild?.firstChild?.marks).toEqual([])
  })

  it('复制图片保留题注、尺寸、对齐和链接，副本使用新的块 ID', () => {
    const source = createEditor({ type: 'doc', content: [{ type: 'image', attrs: {
      diffId: 'image_original', src: '/uploads/sample.png', width: 240, height: 120, align: 'right',
    }, content: [{ type: 'imageCaption', content: [{ type: 'text', text: '图片题注', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] }] })
    source.commands.setNodeSelection(0)
    const copied = source.view.serializeForClipboard(source.state.selection.content())
    const target = createEditor()
    target.view.pasteHTML(copied.dom.innerHTML)
    expect(target.state.doc.firstChild?.attrs).toMatchObject({ src: '/uploads/sample.png', width: 240, height: 120, align: 'right' })
    expect(target.state.doc.firstChild?.attrs.diffId).not.toBe('image_original')
    expect(target.state.doc.firstChild?.textContent).toBe('图片题注')
    expect(target.state.doc.firstChild?.firstChild?.firstChild?.marks[0]?.attrs.href).toBe('https://example.com')
  })
})
