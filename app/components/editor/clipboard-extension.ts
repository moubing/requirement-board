import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { Plugin, type EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { looksLikeMarkdown } from '#shared/editor/markdown'
import { createOrderedListPastePlugin } from './ordered-list-paste'

function clipboardFragmentHTML(html: string) {
  // Windows 的系统剪贴板会给编辑器 HTML 加上 html/body、片段注释和 CRLF。
  // data-pm-slice 会开启空白保留，必须先去掉包装，避免把包装换行变成正文 hardBreak。
  const start = /<!--StartFragment-->/i.exec(html)
  const end = /<!--EndFragment-->/i.exec(html)
  if (!start || !end || start.index >= end.index) return html
  const fragment = html.slice(start.index + start[0].length, end.index)
  // 编辑器片段自带完整节点与选区信息；外部 HTML 仍保留可能承载格式的祖先上下文。
  return /\bdata-pm-slice\s*=/.test(fragment) ? fragment : html
}

export function selectedClipboardText(state: EditorState) {
  // 仅在实际文字块之间分行。容器（列表、列表项等）不能各自再增加空行。
  // 不 trim：真实空段落、代码缩进和用户选中的换行必须保留。
  return [...state.selection.ranges]
    .sort((a, b) => a.$from.pos - b.$from.pos)
    .map(({ $from, $to }) => state.doc.textBetween(
      $from.pos, $to.pos, '\n', node => node.type.name === 'hardBreak' ? '\n' : '',
    ))
    .join('\n')
}

export async function writeEditorSelectionToClipboard(view: EditorView) {
  const clipboard = navigator.clipboard
  if (!clipboard) throw new Error('当前浏览器不支持写入剪贴板')
  const { dom, text } = view.serializeForClipboard(view.state.selection.content())
  if (typeof clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
    await clipboard.write([new ClipboardItem({
      'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })])
  } else {
    await clipboard.writeText(text)
  }
}

export const EditorClipboard = Extension.create({
  name: 'editorClipboard',

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        clipboardTextSerializer: (_slice, view) => selectedClipboardText(view.state),
        transformPastedHTML: clipboardFragmentHTML,
      },
    }), createOrderedListPastePlugin()]
  },
})

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    let plainTextShortcut = false

    return [new Plugin({
      props: {
        handleDOMEvents: {
          keydown(_view, event) {
            plainTextShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v'
            return false
          },
          keyup() { plainTextShortcut = false; return false },
          blur() { plainTextShortcut = false; return false },
        },
        handlePaste(view, event) {
          const plain = plainTextShortcut
          plainTextShortcut = false
          // HTML 的 data-pm-slice 保存选区边界，必须交给原生富文本粘贴恢复。
          if (plain || event.clipboardData?.getData('text/html') || view.state.selection.$from.parent.type.spec.code) return false
          const text = event.clipboardData?.getData('text/plain')
          if (!text || !looksLikeMarkdown(text) || !editor.markdown) return false

          const parsed = editor.schema.nodeFromJSON(editor.markdown.parse(text))
          // 使用粘贴的开放切片语义，避免整块 insertContent 在选区两端制造空段落。
          view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(parsed.content))
            .setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
          return true
        },
      },
    })]
  },
})
