import { TaskItem, TaskList } from '@tiptap/extension-list'
import type { RichTextNode } from './document'

// 网页、服务端与 Markdown 共用官方节点模型；交互视图在网页侧扩展。
export const RequirementTaskList = TaskList
export const RequirementTaskItem = TaskItem.configure({ nested: true })

export type ListNodeType = 'bulletList' | 'orderedList' | 'taskList'
export function isListNodeType(type: string): type is ListNodeType {
  return type === 'bulletList' || type === 'orderedList' || type === 'taskList'
}

export function listItemType(type: ListNodeType) {
  return type === 'taskList' ? 'taskItem' : 'listItem'
}

export function containsTaskItems(node?: RichTextNode | null): boolean {
  return !!node && (node.type === 'taskItem' || !!node.content?.some(containsTaskItems))
}
