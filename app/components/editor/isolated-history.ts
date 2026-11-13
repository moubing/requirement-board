import { closeHistory } from '@tiptap/pm/history'
import type { Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { yUndoPluginKey } from '@tiptap/y-tiptap'

export const ISOLATED_HISTORY = 'requirementIsolatedHistory'

/** 确认前后都保留普通历史和 Yjs 的独立撤销边界。 */
export function dispatchIsolatedHistory(view: EditorView, transaction: Transaction) {
  const manager = yUndoPluginKey.getState(view.state)?.undoManager
  manager?.stopCapturing()
  view.dispatch(closeHistory(transaction).setMeta(ISOLATED_HISTORY, true))
  manager?.stopCapturing()
  view.dispatch(closeHistory(view.state.tr))
}
