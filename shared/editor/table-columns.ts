import type { RichTextNode } from './document'

export const TABLE_MIN_COLUMN_WIDTH = 80

/** 与 TableKit colgroup 一致：第一行的 colspan 展开为物理列，0 代表自动宽度。 */
export function tableColumnWidths(node: RichTextNode | null | undefined): number[] {
  if (node?.type !== 'table') return []
  return (node.content?.[0]?.content ?? []).flatMap(cell => {
    const span = typeof cell.attrs?.colspan === 'number' ? cell.attrs.colspan : 1
    const widths = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : []
    return Array.from({ length: span }, (_, index) => {
      const width: unknown = widths[index]
      return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0
    })
  })
}
