// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { closeHistory } from '@tiptap/pm/history'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import { ResizableTable } from '../../app/components/editor/resizable-table'

const editors: Editor[] = []

function createEditor() {
  const element = document.createElement('div')
  document.body.append(element)

  const editor = new Editor({
    element,
    extensions: [StarterKit, TableKit.configure({ table: false }), ResizableTable, BlockId],
    content: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
  })
  editors.push(editor)
  return editor
}

function getTable(editor: Editor) {
  const table = editor.getJSON().content?.find((node) => node.type === 'table')
  expect(table).toBeDefined()
  return table!
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
})

describe('table editor commands', () => {
  it('creates a headed table and supports adding or deleting rows and columns', () => {
    const editor = createEditor()

    expect(editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: true })).toBe(true)

    let table = getTable(editor)
    expect(table.attrs?.diffId).toEqual(expect.any(String))
    expect(table.content).toHaveLength(3)
    expect(table.content?.every((row) => row.content?.length === 2)).toBe(true)
    expect(table.content?.[0]?.content?.every((cell) => cell.type === 'tableHeader')).toBe(true)

    expect(editor.commands.addColumnAfter()).toBe(true)
    expect(editor.commands.addRowAfter()).toBe(true)

    table = getTable(editor)
    expect(table.content).toHaveLength(4)
    expect(table.content?.every((row) => row.content?.length === 3)).toBe(true)

    expect(editor.commands.deleteColumn()).toBe(true)
    expect(editor.commands.deleteRow()).toBe(true)

    table = getTable(editor)
    expect(table.content).toHaveLength(3)
    expect(table.content?.every((row) => row.content?.length === 2)).toBe(true)
  })

  it('保留未受影响单元格身份；合并、拆分、表头转换分配新身份，撤销恢复原身份', () => {
    const editor = createEditor()
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: false })
    const cells = () => getTable(editor).content!.flatMap(row => row.content!)
    const ids = () => cells().map(cell => cell.attrs!.diffId)
    const original = ids()
    expect(new Set(original).size).toBe(9)
    expect(original.every(id => typeof id === 'string' && id)).toBe(true)
    editor.view.dispatch(closeHistory(editor.state.tr))
    const positions: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions.push(pos) })
    editor.commands.setCellSelection({ anchorCell: positions[0]!, headCell: positions[1]! })
    expect(editor.commands.mergeCells()).toBe(true)
    const merged = ids()[0]
    expect(merged).not.toBe(original[0])
    expect(ids()).not.toContain(original[1])
    expect(ids().slice(1)).toEqual(original.slice(2))
    editor.commands.undo()
    expect(ids()).toEqual(original)
    editor.commands.redo()
    expect(ids()).toEqual([merged, ...original.slice(2)])
    editor.view.dispatch(closeHistory(editor.state.tr))
    expect(editor.commands.splitCell()).toBe(true)
    expect(ids().slice(0, 2)).not.toContain(merged)
    const split = ids()
    editor.commands.undo()
    expect(ids()).toEqual([merged, ...original.slice(2)])
    editor.commands.redo()
    expect(ids()).toEqual(split)
    editor.commands.setTextSelection(positions[0]! + 2)
    const beforeHeader = ids()
    editor.view.dispatch(closeHistory(editor.state.tr))
    expect(editor.commands.toggleHeaderCell()).toBe(true)
    expect(ids()[0]).not.toBe(beforeHeader[0])
    expect(ids().slice(1)).toEqual(beforeHeader.slice(1))
    editor.commands.undo()
    expect(ids()).toEqual(beforeHeader)
    const remaining: string[] = []
    editor.state.doc.descendants(node => { if (node.attrs.diffId) remaining.push(node.attrs.diffId) })
    expect(new Set(remaining).size).toBe(remaining.length)
  })
})
