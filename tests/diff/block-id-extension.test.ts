import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'

import { createBlockIdPlugin } from '../../app/components/editor/block-id-extension'

const schema = new Schema({
  marks: { bold: {} },
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { diffId: { default: null } },
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: {
        diffId: { default: null },
        level: { default: 2 },
      },
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { diffId: { default: null } },
    },
    listItem: {
      content: 'paragraph block*',
      attrs: { diffId: { default: null } },
    },
    text: { group: 'inline' },
  },
})

function collectDiffIds(document: ProseMirrorNode) {
  const diffIds: string[] = []
  document.descendants((node) => {
    if (typeof node.attrs.diffId === 'string' && node.attrs.diffId) {
      diffIds.push(node.attrs.diffId)
    }
  })
  return diffIds
}

describe('block id ProseMirror plugin', () => {
  it('有效长文档的段内输入和 mark 变化不再次遍历整篇文档', () => {
    const document = schema.node('doc', null, Array.from({ length: 1000 }, (_, index) =>
      schema.node('paragraph', { diffId: `p_${index}` }, schema.text('正文'))))
    let state = EditorState.create({ doc: document, schema, plugins: [createBlockIdPlugin()] })
    for (const make of [
      () => state.tr.insertText('最后输入', state.doc.content.size - 1),
      () => state.tr.addMark(1, 3, schema.marks.bold!.create()),
      () => state.tr.removeMark(1, 3, schema.marks.bold!),
    ]) {
      const transaction = make()
      const traversal = vi.spyOn(transaction.doc, 'descendants')
      const result = state.applyTransaction(transaction)
      expect(traversal).not.toHaveBeenCalled()
      expect(result.transactions).toHaveLength(1)
      state = result.state
      traversal.mockRestore()
    }
    expect(new Set(collectDiffIds(state.doc)).size).toBe(1000)
  })

  it('无法证明初始 ID 合法时，普通输入也执行修复', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('旧草稿'))])
    const state = EditorState.create({ doc, schema, plugins: [createBlockIdPlugin()] })
    const result = state.applyTransaction(state.tr.insertText('字', 1))
    expect(result.state.doc.firstChild!.attrs.diffId).toMatch(/^para_/)
    expect(result.transactions).toHaveLength(2)
  })

  it('assigns an id to a newly inserted block without moving its selection', () => {
    const document = schema.node('doc', null, [
      schema.node('heading', { diffId: 'head_existing', level: 2 }, schema.text('快速开始')),
      schema.node('paragraph', { diffId: 'para_existing' }, schema.text('后续内容')),
    ])
    const state = EditorState.create({ doc: document, schema, plugins: [createBlockIdPlugin()] })
    const transaction = state.tr.insert(0, schema.node('paragraph'))
    transaction.setSelection(TextSelection.create(transaction.doc, 1))

    const result = state.applyTransaction(transaction)
    const insertedParagraph = result.state.doc.child(0)

    expect(insertedParagraph.attrs.diffId).toMatch(/^para_/)
    expect(result.state.selection.from).toBe(1)
    expect(result.state.selection.empty).toBe(true)
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[1]?.getMeta('addToHistory')).toBe(true)
  })

  it('repairs copied list ids and missing ids in one appended transaction', () => {
    const document = schema.node('doc', null, [
      schema.node('bulletList', { diffId: 'bull_existing' }, [
        schema.node('listItem', { diffId: 'list_copied' }, [
          schema.node('paragraph', { diffId: 'para_copied' }, schema.text('第一项')),
        ]),
        schema.node('listItem', { diffId: 'list_copied' }, [
          schema.node('paragraph', { diffId: 'para_copied' }, schema.text('第二项')),
        ]),
      ]),
    ])
    const state = EditorState.create({ doc: document, schema, plugins: [createBlockIdPlugin()] })
    const transaction = state.tr.insert(state.doc.content.size, schema.node('paragraph'))
    const result = state.applyTransaction(transaction)
    const diffIds = collectDiffIds(result.state.doc)

    expect(diffIds).toHaveLength(6)
    expect(new Set(diffIds).size).toBe(diffIds.length)
    expect(result.transactions).toHaveLength(2)
  })

  it('does not append an id transaction for ordinary typing in existing blocks', () => {
    const document = schema.node('doc', null, [
      schema.node('paragraph', { diffId: 'para_existing' }, schema.text('正文')),
    ])
    const state = EditorState.create({
      doc: document,
      schema,
      selection: TextSelection.atEnd(document),
      plugins: [createBlockIdPlugin()],
    })

    const result = state.applyTransaction(state.tr.insertText('。'))

    expect(result.state.doc.textContent).toBe('正文。')
    expect(result.transactions).toHaveLength(1)
  })
})
