import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { TABLE_MIN_COLUMN_WIDTH } from '~~/shared/editor/table-columns'

export { TABLE_MIN_COLUMN_WIDTH }
export interface TableColumnTarget {
  tableId: string
  anchors: { id: string; offset: number; colspan: number }[]
}

/** 记录列内现有单元格身份，远端插列后仍调整原列；目标被删除或身份不再一致时取消。 */
export function captureTableColumn(state: EditorState, cellPosition: number): TableColumnTarget | null {
  const $cell = state.doc.resolve(cellPosition), cell = $cell.nodeAfter
  if (!cell || !['tableCell', 'tableHeader'].includes(cell.type.name) || $cell.depth < 2) return null
  const table = $cell.node(-1), map = TableMap.get(table), start = $cell.start(-1)
  const column = map.colCount(cellPosition - start) + cell.attrs.colspan - 1
  const anchors = [...new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width + column]!))]
    .map(pos => ({ id: String(table.nodeAt(pos)!.attrs.diffId ?? ''), offset: column - map.colCount(pos), colspan: table.nodeAt(pos)!.attrs.colspan }))
    .filter(anchor => anchor.id)
  return table.attrs.diffId && anchors.length ? { tableId: table.attrs.diffId, anchors } : null
}

export function resolveTableColumn(doc: ProseMirrorNode, target: TableColumnTarget) {
  let found: { node: ProseMirrorNode; pos: number } | null = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'table' && node.attrs.diffId === target.tableId) found = { node, pos }
    return !found
  })
  if (!found) return null
  const { node, pos } = found as { node: ProseMirrorNode; pos: number }
  const map = TableMap.get(node), columns = new Set<number>()
  const anchors = new Map(target.anchors.map(anchor => [anchor.id, anchor]))
  for (const cellPos of new Set(map.map)) {
    const cell = node.nodeAt(cellPos)!, anchor = anchors.get(String(cell.attrs.diffId))
    if (anchor && anchor.colspan === cell.attrs.colspan) columns.add(map.colCount(cellPos) + anchor.offset)
  }
  if (columns.size !== 1) return null
  return { node, pos, map, column: [...columns][0]! }
}

export function tableColumnWidthTransaction(state: EditorState, target: TableColumnTarget, width: number | null) {
  if (width !== null && !Number.isFinite(width)) return null
  const table = resolveTableColumn(state.doc, target)
  if (!table) return null
  const value = width === null ? 0 : Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(width))
  const tr = state.tr, seen = new Set<number>()
  for (let row = 0; row < table.map.height; row++) {
    const pos = table.map.map[row * table.map.width + table.column]!
    if (seen.has(pos)) continue
    seen.add(pos)
    const cell = table.node.nodeAt(pos)!, index = table.column - table.map.colCount(pos)
    const columns: number[] = cell.attrs.colwidth?.slice() ?? Array(cell.attrs.colspan).fill(0)
    if (columns[index] === value) continue
    columns[index] = value
    tr.setNodeMarkup(table.pos + 1 + pos, undefined, { ...cell.attrs, colwidth: columns.some(Boolean) ? columns : null })
  }
  return tr.docChanged ? tr : null
}
