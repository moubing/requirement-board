import { Extension } from '@tiptap/core'
import { TextSelection, type EditorState } from '@tiptap/pm/state'

export function getTypingMarks(state: EditorState) {
  const { selection, storedMarks } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return []

  // 空数组表示明确停止继承，不能回退到光标两侧文字的 marks。
  return selection.$from.parent.type.allowedMarks(storedMarks ?? selection.$from.marks())
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    typingMarks: {
      /** 只退出光标处后续输入的行内格式，保留已有正文和块结构。 */
      stopMarkInheritance: () => ReturnType
    }
  }
}

export const TypingMarks = Extension.create({
  name: 'typingMarks',

  addCommands() {
    return {
      stopMarkInheritance: () => ({ editor, state, tr, dispatch }) => {
        if (!editor.isEditable || editor.view.composing || !getTypingMarks(state).length) return false

        if (dispatch) tr.setStoredMarks([])
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-\\': () => this.editor.commands.stopMarkInheritance(),
    }
  },
})
