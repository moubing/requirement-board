import { createBlockMarkdownSpec, findParentNode } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import type { RichTextNode } from './document'

// 沿用官方节点结构；展开状态不属于正文，也不接受 open 属性。
const markdown = (nodeName: string, content: 'block' | 'inline' = 'block') => createBlockMarkdownSpec({
  nodeName, content, allowedAttributes: [], parseAttributes: () => ({}),
})
export const RequirementDetails = Details.extend({
  ...markdown('details'),
  addCommands() {
    return {
      ...this.parent?.(),
      unsetDetails: () => ({ state, chain }) => {
        const details = findParentNode(node => node.type === this.type)(state.selection)
        if (!details) return false
        const summary = details.node.firstChild!, body = details.node.lastChild!
        const paragraph = state.schema.nodes.paragraph!.create({ diffId: summary.attrs.diffId }, summary.content)
        return chain().insertContentAt({ from: details.pos, to: details.pos + details.node.nodeSize }, [
          paragraph.toJSON(), ...body.content.toJSON(),
        ]).setTextSelection(details.pos + 1).run()
      },
    }
  },
}).configure({ persist: false })
export const RequirementDetailsSummary = DetailsSummary.extend({
  ...markdown('detailsSummary', 'inline'),
  renderMarkdown: (node, helpers) => `:::detailsSummary\n\n${helpers.renderChildren(node.content ?? [], '')}\n\n:::`,
})
export const RequirementDetailsContent = DetailsContent.extend({ ...markdown('detailsContent') })

export function containsDetails(node?: RichTextNode | null): boolean {
  return !!node && (node.type === 'details' || !!node.content?.some(containsDetails))
}
