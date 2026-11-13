import type { Editor } from '@tiptap/core'
import * as Y from 'yjs'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import { COLLABORATION_FIELD } from '#shared/collaboration/document'

export function captureCollaborativePosition(editor: Editor, document: Y.Doc | undefined, position: number) {
  const binding = ySyncPluginKey.getState(editor.state)?.binding
  if (!document || !binding) return undefined
  const relative = absolutePositionToRelativePosition(position, document.getXmlFragment(COLLABORATION_FIELD), binding.mapping)
  return relative ? JSON.stringify(Y.relativePositionToJSON(relative)) : undefined
}

export function restoreCollaborativePosition(editor: Editor, document: Y.Doc | undefined, relative: string | undefined, fallback: number) {
  const binding = ySyncPluginKey.getState(editor.state)?.binding
  if (document && binding && relative) {
    try {
      const position = relativePositionToAbsolutePosition(document, document.getXmlFragment(COLLABORATION_FIELD),
        Y.createRelativePositionFromJSON(JSON.parse(relative)), binding.mapping)
      if (position !== null) return position
    } catch { /* 旧版检查点继续使用已保存的绝对位置。 */ }
  }
  return Math.min(fallback, editor.state.doc.content.size)
}
