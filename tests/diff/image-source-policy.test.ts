// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageSourcePolicy } from '../../app/components/editor/image-source-policy'
import { MarkdownPaste } from '../../app/components/editor/clipboard-extension'

const editors: Editor[] = []
function setup(restricted = true) {
  const blocked = vi.fn()
  const editor = new Editor({
    extensions: [StarterKit, Image, Markdown, MarkdownPaste, ...(restricted ? [ImageSourcePolicy.configure({ sources: ['/demo/nodes.svg'], onBlocked: blocked })] : [])],
    content: '<p>原文</p>',
  })
  editors.push(editor)
  editor.commands.focus('end')
  return { editor, blocked }
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))

describe('受限编辑器的图片入口', () => {
  it.each(['https://tracking.example/pixel.png', '/uploads/private.png', '/demo/other.svg', '/demo/nodes.svg?track=1', 'data:image/png;base64,AA==', 'blob:https://example.test/image'])('事务在渲染前拒绝未批准来源：%s', src => {
    const { editor, blocked } = setup()
    const before = editor.getJSON()
    editor.commands.insertContent({ type: 'image', attrs: { src } })
    expect(editor.getJSON()).toEqual(before)
    expect(blocked).toHaveBeenCalled()
  })
  it('保留普通 HTML 文字和格式，同时在解析前移除外部图片', () => {
    const { editor, blocked } = setup()
    editor.view.pasteHTML('<p><strong>新文字</strong><img src="https://tracking.example/pixel"><img src="/uploads/private.png"></p>')
    expect(editor.getText()).toContain('新文字')
    expect(JSON.stringify(editor.getJSON())).toContain('bold')
    expect(editor.getHTML()).not.toContain('<img')
    expect(blocked).toHaveBeenCalled()
  })
  it('Markdown 图片粘贴也经过事务白名单，失败不进入撤销记录', () => {
    const { editor, blocked } = setup()
    const before = editor.getJSON()
    const transfer = new DataTransfer()
    transfer.setData('text/plain', '![外部图片](https://tracking.example/pixel.png)')
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    expect(editor.getJSON()).toEqual(before)
    expect(editor.can().undo()).toBe(false)
    expect(blocked).toHaveBeenCalled()
  })
  it('HTML 清理在 DOM 解析前覆盖非正文资源元素、背景和事件属性', () => {
    const { editor, blocked } = setup()
    let cleaned = '<p style="background:url(https://tracking.example/pixel)" background="https://tracking.example/pixel" onclick="fetch(\'/api/meta\')">保留文字</p><input type="image" src="https://tracking.example/pixel"><svg><image href="https://tracking.example/pixel" /></svg><script src="https://tracking.example/script"></script>'
    editor.view.someProp('transformPastedHTML', transform => {
      cleaned = transform(cleaned, editor.view)
    })
    expect(cleaned).toBe('<p>保留文字</p>')
    expect(blocked).toHaveBeenCalled()
  })
  it('允许预置图片、题注外普通编辑和撤销，默认编辑器不受限制', () => {
    const { editor, blocked } = setup()
    editor.view.pasteHTML('<img src="/demo/nodes.svg" srcset="https://tracking.example/pixel 2x">')
    expect(editor.getHTML()).toContain('/demo/nodes.svg')
    expect(editor.getHTML()).not.toContain('srcset')
    expect(blocked).not.toHaveBeenCalled()
    editor.commands.undo()
    expect(editor.getHTML()).not.toContain('<img')
    const normal = setup(false).editor
    normal.commands.insertContent({ type: 'image', attrs: { src: '/uploads/real-image.png' } })
    expect(normal.getHTML()).toContain('/uploads/real-image.png')
  })
})
