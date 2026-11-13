import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { revertDraftChange, type RevertChangePayload } from '../../../shared/diff/revert-draft-change'
import type { RichTextDocument } from '../../../shared/editor/document'
import { normalizeTrailingParagraph } from '../../../shared/editor/trailing-paragraph'

/** 经过普通编辑事务与标注守卫，不以外部装载绕过确认或重建协作历史。 */
export function restoreVersionChange(editor: Editor, base: RichTextDocument, change: RevertChangePayload) {
  const result = revertDraftChange(editor.getJSON() as RichTextDocument, base, change)
  if (!result.changed) return false
  const next = editor.schema.nodeFromJSON(normalizeTrailingParagraph(result.document))
  const start = editor.state.doc.content.findDiffStart(next.content)
  if (start === null) return false
  const end = editor.state.doc.content.findDiffEnd(next.content)!
  const overlap = start - Math.min(end.a, end.b)
  if (overlap > 0) { end.a += overlap; end.b += overlap }
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
  undoManager?.stopCapturing()
  editor.view.dispatch(closeHistory(editor.state.tr.replace(start, end.a, next.slice(start, end.b))))
  undoManager?.stopCapturing()
  return true
}
