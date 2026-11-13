import type { ChainedCommands, Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { ChevronDown, CodeXml, Heading1, Heading2, Heading3, Image, Info, Lightbulb, List, ListOrdered, ListTodo, Minus, Pilcrow, Quote, TriangleAlert, OctagonAlert, Table } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { CalloutTone } from '~~/shared/editor/callout'

export interface SlashCommand {
  id: string
  title: string
  group: string
  alias: string
  icon: Component
  apply?: (chain: ChainedCommands) => ChainedCommands
}

export const slashCommands: SlashCommand[] = [
  { id: 'paragraph', title: '正文', group: '文本', alias: 'text', icon: Pilcrow, apply: c => c.command(({ tr, commands }) => tr.selection.$from.parent.type.name === 'paragraph' || commands.setParagraph()) },
  { id: 'h1', title: '一级标题', group: '文本', alias: 'h1', icon: Heading1, apply: c => c.setHeading({ level: 1 }) },
  { id: 'h2', title: '二级标题', group: '文本', alias: 'h2', icon: Heading2, apply: c => c.setHeading({ level: 2 }) },
  { id: 'h3', title: '三级标题', group: '文本', alias: 'h3', icon: Heading3, apply: c => c.setHeading({ level: 3 }) },
  { id: 'bulletList', title: '无序列表', group: '列表与引用', alias: 'ul', icon: List, apply: c => c.toggleBulletList() },
  { id: 'orderedList', title: '有序列表', group: '列表与引用', alias: 'ol', icon: ListOrdered, apply: c => c.toggleOrderedList() },
  { id: 'taskList', title: '任务清单', group: '列表与引用', alias: 'task', icon: ListTodo, apply: c => c.toggleTaskList() },
  { id: 'blockquote', title: '引用', group: '列表与引用', alias: 'quote', icon: Quote, apply: c => c.setBlockquote() },
  ...(['note', 'tip', 'warning', 'danger'] as const).map((tone, i) => ({
    id: tone, title: `提示块 · ${['说明', '建议', '注意', '风险'][i]}`, group: '组件块',
    alias: tone, icon: [Info, Lightbulb, TriangleAlert, OctagonAlert][i]!,
    apply: (c: ChainedCommands) => c.insertCallout({ tone: tone as CalloutTone }),
  })),
  { id: 'codeBlock', title: '代码块', group: '组件块', alias: 'code', icon: CodeXml, apply: c => c.setCodeBlock() },
  { id: 'details', title: '折叠块', group: '组件块', alias: 'details', icon: ChevronDown, apply: c => c.setDetails() },
  { id: 'horizontalRule', title: '分隔线', group: '组件块', alias: 'hr', icon: Minus, apply: c => c.setHorizontalRule() },
  { id: 'table', title: '表格', group: '插入', alias: 'table', icon: Table, apply: c => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: 'image', title: '图片', group: '插入', alias: 'image', icon: Image },
]

export interface SlashRange { from: number; to: number; query: string; trigger: string }

/** 只检查当前文字块；不扫描长文，也不从已有正文/远端更新自动打开菜单。 */
export function slashRangeAt(state: Pick<EditorState, 'selection'>): SlashRange | null {
  const { empty, $from } = state.selection
  if (!empty || !['paragraph', 'heading', 'callout'].includes($from.parent.type.name)) return null
  const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC')
  const match = /(?:^|\s)([/／])([^/／\n]{0,64})$/.exec(text) ?? /^(、)([^/／、\n]{0,64})$/.exec(text)
  if (!match) return null
  const trigger = match[1]!
  const query = match[2]!
  return { from: $from.pos - query.length - 1, to: $from.pos, trigger, query }
}

export function availableSlashCommands(editor: Editor, range: SlashRange) {
  const query = range.query.trim().toLocaleLowerCase()
  return slashCommands.filter(command => {
    if (query && ![command.title, command.alias].some(name => name.toLocaleLowerCase().includes(query))) return false
    // 表格内部不创建嵌套表格，其他命令按当前 schema 和选区实际探测。
    if (command.id === 'table' && editor.isActive('table')) return false
    if (command.id === 'image') return editor.can().chain().deleteRange(range).insertContent({ type: 'image', attrs: { src: '/uploads/probe.png' }, content: [{ type: 'imageCaption' }] }).run()
    return command.apply!(editor.can().chain().deleteRange(range)).run()
  })
}
