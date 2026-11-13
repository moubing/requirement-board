import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { CodeColorRange } from './code-highlight'

interface HighlightUpdate { owner: object; from: number; to: number; decorations: Decoration[] }
export const codeHighlightKey = new PluginKey<DecorationSet>('requirement-code-highlight')
export function createCodeHighlightPlugin() {
  return new Plugin({
    key: codeHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(transaction, previous) {
        let decorations = transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous
        const update = transaction.getMeta(codeHighlightKey) as HighlightUpdate | undefined
        if (update) {
          decorations = decorations.remove(decorations.find(update.from, update.to, spec => spec.codeOwner === update.owner))
            .add(transaction.doc, update.decorations)
        }
        return decorations
      },
    },
    props: { decorations: state => codeHighlightKey.getState(state) },
  })
}

export function applyCodeHighlight(view: EditorView, position: number, owner: object, ranges: CodeColorRange[]) {
  const node = view.state.doc.nodeAt(position)
  if (node?.type.name !== 'codeBlock') return
  const from = position + 1, to = from + node.content.size
  const decorations = ranges.filter(range => range.to <= node.content.size).map(range => Decoration.inline(
    from + range.from, from + range.to,
    { class: 'requirement-code-token', style: `--code-token-color:${range.color}` }, { codeOwner: owner },
  ))
  view.dispatch(view.state.tr.setMeta(codeHighlightKey, { owner, from, to, decorations } satisfies HighlightUpdate).setMeta('addToHistory', false))
}
