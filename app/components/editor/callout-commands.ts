import type { Editor } from '@tiptap/core'
import { isCalloutTone } from '~~/shared/editor/callout'
import { dispatchIsolatedHistory } from './isolated-history'

/** 用稳定 ID 重新定位，菜单打开期间的远端编辑不能让命令命中另一块。 */
export function setCalloutTone(editor: Editor, diffId: string, tone: unknown) {
  if (!editor.isEditable || !isCalloutTone(tone)) return false
  let position: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'callout' && node.attrs.diffId === diffId) position = pos
  })
  if (position === undefined) return false
  const node = editor.state.doc.nodeAt(position)!
  if (node.attrs.tone === tone) return true
  dispatchIsolatedHistory(editor.view, editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, tone }))
  return true
}
