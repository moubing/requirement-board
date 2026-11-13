import type { RichTextDocument } from '../editor/document'
import { buildRichTextDiff, type NormalizedDiffBlock } from '../diff/rich-text-diff'

/** 复用网页的块、格式、图片和表格判定，只压缩输出，不转换持久化格式。 */
export function agentDiff(base: { title: string; contentJson: RichTextDocument }, target: { title: string; contentJson: RichTextDocument }) {
  const result = buildRichTextDiff(base.contentJson, target.contentJson)
  const sections: string[] = []
  const side = (block: NormalizedDiffBlock | null) => block ? { id: block.id, type: block.type, text: block.text, node: block.node, list: block.list } : null
  const blocks = result.pairs.flatMap(pair => {
    const block = pair.target ?? pair.base!
    if (block.type === 'heading') {
      const level = Number(block.node.attrs?.level ?? 1)
      sections.length = level - 1
      sections[level - 1] = block.text
    }
    if (pair.status === 'unchanged') return []
    return [{ id: pair.id, status: pair.status, section: sections.filter(Boolean), before: side(pair.base), after: side(pair.target),
      attributesChanged: !!pair.base && !!pair.target && pair.base.attrsSignature !== pair.target.attrsSignature,
      formatChanges: pair.targetChunks.flatMap(chunk => chunk.formatChange ? [{ text: chunk.value, ...chunk.formatChange }] : []),
      beforeChunks: pair.baseChunks, afterChunks: pair.targetChunks,
      cells: pair.table?.rows.flatMap((row, rowIndex) => row.cells.flatMap((cell, columnIndex) => cell.status === 'unchanged' ? [] : [{
        row: rowIndex + 1, column: columnIndex + 1, status: cell.status, before: cell.base, after: cell.target,
        beforeChunks: cell.baseChunks, afterChunks: cell.targetChunks,
      }])) }]
  })
  return { counts: result.counts, title: { changed: base.title !== target.title, before: base.title, after: target.title }, blocks }
}
