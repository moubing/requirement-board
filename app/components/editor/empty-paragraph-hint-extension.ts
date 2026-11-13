import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 仅装饰当前光标所在的空段落，不写入节点属性、撤销历史或 Yjs 状态。
export const EmptyParagraphHint = Extension.create({
  name: 'emptyParagraphHint',

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        decorations(state) {
          const { selection } = state
          const { $from } = selection
          if (!(selection instanceof TextSelection) || !selection.empty
            || $from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0) {
            return DecorationSet.empty
          }
          return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), {
            class: 'is-empty-paragraph-current',
          })])
        },
      },
    })]
  },
})
