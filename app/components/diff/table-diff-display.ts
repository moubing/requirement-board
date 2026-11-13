import type { RichTextNode } from '~~/shared/editor/document'
import { TABLE_MIN_COLUMN_WIDTH, tableColumnWidths } from '~~/shared/editor/table-columns'

/** 两侧共用比例，以 720px 为参考；保留 80px 可读列宽，剩余宽度交给块内滚动。 */
export function buildTableDiffDisplay(base: RichTextNode | null | undefined, target: RichTextNode | null | undefined) {
  const source = [base, target].map(tableColumnWidths)
  const widths = source.map(columns => columns.map(width => Math.max(TABLE_MIN_COLUMN_WIDTH, width)))
  const largest = Math.max(1, ...widths.map(columns => columns.reduce((sum, width) => sum + width, 0)))
  const smallest = Math.min(...widths.flat())
  const scale = Math.max(TABLE_MIN_COLUMN_WIDTH / smallest, Math.min(1, 720 / largest))
  const automatic = source.every(columns => columns.every(width => !width))
  const preview = (columns: number[]) => ({
    columns: columns.map(width => width * scale),
    width: automatic ? '100%' : `${columns.reduce((sum, width) => sum + width, 0) * scale}px`,
    minWidth: `${columns.length * TABLE_MIN_COLUMN_WIDTH}px`,
  })
  return { base: preview(widths[0]!), target: preview(widths[1]!), automatic }
}
