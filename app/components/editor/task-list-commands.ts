import type { Editor } from '@tiptap/core'
import { dispatchIsolatedHistory } from './isolated-history'

/** 按稳定身份更新当前节点，保留选区并隔离前后输入的撤销。 */
export function setTaskItemChecked(editor: Editor, diffId: string, checked: boolean) {
  if (!editor.isEditable || typeof checked !== 'boolean' || !diffId) return false
  let position: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'taskItem' && node.attrs.diffId === diffId) position = pos
  })
  if (position === undefined) return false
  const node = editor.state.doc.nodeAt(position)!
  if (node.attrs.checked === checked) return true
  dispatchIsolatedHistory(editor.view, editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked }))
  return editor.state.doc.nodeAt(position)?.attrs.checked === checked
}
