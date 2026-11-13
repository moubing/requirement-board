import { describe, expect, it } from 'vitest'
import { EditorState } from '@tiptap/pm/state'
import { richTextProseMirrorSchema as schema } from '../../shared/editor/validation'
import { ensureBlockIds, type RichTextDocument, type RichTextNode } from '../../shared/editor/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { captureTableColumn, resolveTableColumn, tableColumnWidthTransaction } from '../../app/components/editor/table-column-width'
import { buildTableDiffDisplay } from '../../app/components/diff/table-diff-display'

const cell = (id: string, attrs = {}): RichTextNode => ({ type: 'tableCell', attrs: { diffId: id, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] })
function content(): RichTextDocument {
  return ensureBlockIds({ type: 'doc', content: [{ type: 'table', attrs: { diffId: 'table' }, content: [0, 1, 2].map(row => ({ type: 'tableRow', content: [0, 1, 2].map(col => cell(`cell-${row}-${col}`)) })) }] })
}
const stateFor = (json: RichTextDocument) => EditorState.create({ schema, doc: schema.nodeFromJSON(json) })
function capture(state: EditorState, id: string) {
  let position = -1
  state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) position = pos })
  return captureTableColumn(state, position)!
}

describe('表格列宽事务', () => {
  it('一次事务写整列、保留身份/正文，清除宽度恢复自动，非法数值不写入', () => {
    let state = stateFor(content())
    const original = state.doc.toJSON(), target = capture(state, 'cell-0-1')
    const transaction = tableColumnWidthTransaction(state, target, 39)!
    expect(transaction.steps).toHaveLength(3)
    state = state.apply(transaction)
    const json = state.doc.toJSON()
    json.content[0].content.forEach((row: any, index: number) => {
      expect(row.content[1].attrs).toMatchObject({ diffId: `cell-${index}-1`, colwidth: [80] })
      expect(row.content[1].content).toEqual(original.content[0].content[index].content[1].content)
      expect(row.content[0]).toEqual(original.content[0].content[index].content[0])
    })
    expect(tableColumnWidthTransaction(state, target, 80)).toBeNull()
    expect(tableColumnWidthTransaction(state, target, Infinity)).toBeNull()
    state = state.apply(tableColumnWidthTransaction(state, target, null)!)
    expect(state.doc.toJSON()).toEqual(original)
    expect(tableColumnWidthTransaction(state, target, null)).toBeNull()
  })
  it('按最新身份处理远端插列/删除行/改文字，目标列删除后不转移到邻列', () => {
    const original = content(), target = capture(stateFor(original), 'cell-0-1')
    original.content[0]!.content!.forEach((row, index) => row.content!.unshift(cell(`remote-${index}`)))
    original.content[0]!.content!.shift()
    original.content[0]!.content![0]!.content![2]!.content![0]!.content![0]!.text = '远端正文'
    let state = stateFor(ensureBlockIds(original))
    expect(resolveTableColumn(state.doc, target)?.column).toBe(2)
    state = state.apply(tableColumnWidthTransaction(state, target, 217.4)!)
    const rows = state.doc.toJSON().content[0].content
    expect(rows[0].content[2].attrs.colwidth).toEqual([217])
    expect(rows[0].content[2].content[0].content[0].text).toBe('远端正文')
    expect(rows.every((row: any) => row.content.length === 4 && row.content[1].attrs.colwidth === null)).toBe(true)
    original.content[0]!.content!.forEach(row => row.content!.splice(2, 1))
    expect(tableColumnWidthTransaction(stateFor(original), target, 300)).toBeNull()
  })
  it('合并格只改命中的子列，跨行格不重复写入，身份分歧取消', () => {
    const original = ensureBlockIds<RichTextDocument>({ type: 'doc', content: [{ type: 'table', attrs: { diffId: 'table' }, content: [
      { type: 'tableRow', content: [cell('merged', { colspan: 2, rowspan: 2, colwidth: [150, 160] }), cell('right')] },
      { type: 'tableRow', content: [cell('bottom')] },
    ] }] })
    const state = stateFor(original), target = capture(state, 'merged')
    const transaction = tableColumnWidthTransaction(state, target, 250)!
    expect(transaction.steps).toHaveLength(1)
    expect(transaction.doc.firstChild!.firstChild!.firstChild!.attrs.colwidth).toEqual([150, 250])
    original.content[0]!.content![0]!.content![0]!.attrs!.colspan = 3
    expect(resolveTableColumn(stateFor(original).doc, target)).toBeNull()
    const normal = content(), normalTarget = capture(stateFor(normal), 'cell-0-1')
    const row = normal.content[0]!.content![1]!.content!
    ;[row[1], row[2]] = [row[2]!, row[1]!]
    expect(resolveTableColumn(stateFor(normal).doc, normalTarget)).toBeNull()
  })
  it('嵌套表格按自身身份调整，不误改外层表格', () => {
    const original = content(), nested = content().content[0]!
    nested.attrs!.diffId = 'nested'
    nested.content!.forEach(row => row.content!.forEach(cell => { cell.attrs!.diffId = `nested-${cell.attrs!.diffId}` }))
    original.content[0]!.content![0]!.content![0]!.content!.push(nested)
    const state = stateFor(ensureBlockIds(original)), target = capture(state, 'nested-cell-0-1')
    const transaction = tableColumnWidthTransaction(state, target, 190)!
    expect(transaction.steps).toHaveLength(3)
    expect(transaction.doc.firstChild!.firstChild!.firstChild!.attrs.colwidth).toBeNull()
    expect(resolveTableColumn(transaction.doc, target)!.node.firstChild!.child(1).attrs.colwidth).toEqual([190])
  })
})

describe('表格列宽 Diff', () => {
  it('仅列宽变化计为修改并说明原因，正文没有字符增删', () => {
    const original = content(), state = stateFor(original)
    const target = tableColumnWidthTransaction(state, capture(state, 'cell-0-1'), 230)!.doc.toJSON()
    const diff = buildRichTextDiff(state.doc.toJSON(), target)
    expect(diff.counts).toMatchObject({ modified: 1, inserted: 0, deleted: 0 })
    expect(diff.pairs[0]!.table?.columnWidthsChanged).toBe(true)
    expect(diff.pairs[0]!.table!.rows.flatMap(row => row.cells).flatMap(cell => [...cell.baseChunks, ...cell.targetChunks]).every(chunk => chunk.status === 'equal')).toBe(true)
    expect(schema.nodeFromJSON(target).toJSON()).toEqual(target)
  })
  it('两侧使用同一缩放比例，自动列仍可读，超宽表格保留块内滚动空间', () => {
    const table = (widths: number[]) => ({ type: 'table', content: [{ type: 'tableRow', content: widths.map((width, index) => cell(`${index}`, { colwidth: [width] })) }] })
    const display = buildTableDiffDisplay(table([600, 600]), table([900, 900]))
    expect(display.base.columns).toEqual([240, 240])
    expect(display.target.columns).toEqual([360, 360])
    expect(display.target.width).toBe('720px')
    const wide = buildTableDiffDisplay(table([80, 160]), table([80, 3000]))
    expect(wide.target.columns).toEqual([80, 3000])
    expect(wide.target.width).toBe('3080px')
    expect(buildTableDiffDisplay(table([0, 0]), table([0, 0])).automatic).toBe(true)
  })
})
