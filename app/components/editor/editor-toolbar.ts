import type { Component } from 'vue'
import type { ChainedCommands } from '@tiptap/core'
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered, ListTodo, Pilcrow, Quote, Strikethrough } from 'lucide-vue-next'

interface FormatTool {
  label: string
  icon: Component
  shortcut?: string
  name: string
  attrs?: Record<string, unknown>
  command: (chain: ChainedCommands) => ChainedCommands
}

// 就绪前后的工具顺序、图标和分组共用；仅就绪的编辑器绑定命令与选区状态。
export const editorFormatGroups: FormatTool[][] = [
  [
    { label: '普通正文', icon: Pilcrow, name: 'paragraph', command: chain => chain.setParagraph() },
    { label: '一级标题', icon: Heading1, name: 'heading', attrs: { level: 1 }, command: chain => chain.toggleHeading({ level: 1 }) },
    { label: '二级标题', icon: Heading2, name: 'heading', attrs: { level: 2 }, command: chain => chain.toggleHeading({ level: 2 }) },
    { label: '三级标题', icon: Heading3, name: 'heading', attrs: { level: 3 }, command: chain => chain.toggleHeading({ level: 3 }) },
  ],
  [
    { label: '加粗', icon: Bold, shortcut: 'Ctrl+B', name: 'bold', command: chain => chain.toggleBold() },
    { label: '斜体', icon: Italic, shortcut: 'Ctrl+I', name: 'italic', command: chain => chain.toggleItalic() },
    { label: '删除线', icon: Strikethrough, name: 'strike', command: chain => chain.toggleStrike() },
  ],
  [
    { label: '无序列表', icon: List, name: 'bulletList', command: chain => chain.toggleBulletList() },
    { label: '有序列表', icon: ListOrdered, name: 'orderedList', command: chain => chain.toggleOrderedList() },
    { label: '任务清单', icon: ListTodo, name: 'taskList', command: chain => chain.toggleTaskList() },
    { label: '引用', icon: Quote, name: 'blockquote', command: chain => chain.toggleBlockquote() },
  ],
]
