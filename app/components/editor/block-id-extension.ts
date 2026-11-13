import { Extension } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform'
import { isChangeOrigin } from '@tiptap/extension-collaboration'

import { BLOCK_NODE_TYPES, createDiffId } from '../../../shared/editor/document'

const blockNodeTypes = new Set<string>(BLOCK_NODE_TYPES)

function createUniqueDiffId(nodeType: string, seenIds: Set<string>) {
  let diffId = ''
  do {
    diffId = createDiffId(nodeType.slice(0, 4) || 'blk')
  } while (seenIds.has(diffId))
  return diffId
}

function clearCopiedBlockIds(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach(node => {
    if (node.isText) {
      nodes.push(node)
      return
    }
    const attrs = blockNodeTypes.has(node.type.name) ? { ...node.attrs, diffId: null } : node.attrs
    nodes.push(node.type.create(attrs, clearCopiedBlockIds(node.content), node.marks))
  })
  return Fragment.fromArray(nodes)
}

function rootTransaction(transaction: Transaction): Transaction {
  return transaction.getMeta('appendedTransaction') ?? transaction
}

function createBlockIdTransaction(state: EditorState, previous?: ProseMirrorNode) {
  const seenIds = new Set<string>()
  const transaction = state.tr
  const cells = new Map<string, string>()
  const cellShape = (node: ProseMirrorNode) => `${node.type.name}:${node.attrs.rowspan ?? 1}:${node.attrs.colspan ?? 1}`
  previous?.descendants(node => {
    if (['tableCell', 'tableHeader'].includes(node.type.name) && node.attrs.diffId) cells.set(node.attrs.diffId, cellShape(node))
  })

  state.doc.descendants((node, position) => {
    if (!blockNodeTypes.has(node.type.name)) return
    const currentId = typeof node.attrs.diffId === 'string' ? node.attrs.diffId : ''
    const changedCell = ['tableCell', 'tableHeader'].includes(node.type.name) && cells.has(currentId) && cells.get(currentId) !== cellShape(node)
    if (currentId && !seenIds.has(currentId) && !changedCell) {
      seenIds.add(currentId)
      return
    }

    const diffId = createUniqueDiffId(node.type.name, seenIds)
    seenIds.add(diffId)
    transaction.setNodeMarkup(position, node.type, { ...node.attrs, diffId }, node.marks)
  })

  return transaction.docChanged ? transaction.setMeta('blockId', true) : null
}

export function createBlockIdPlugin() {
  const validDocuments = new WeakSet<ProseMirrorNode>()
  function valid(doc: ProseMirrorNode) {
    const ids = new Set<string>()
    let result = true
    doc.descendants(node => {
      if (!blockNodeTypes.has(node.type.name)) return
      const id = node.attrs.diffId
      if (typeof id !== 'string' || !id || ids.has(id)) result = false
      ids.add(id)
    })
    if (result) validDocuments.add(doc)
  }
  function preservesIds(transaction: Transaction) {
    return transaction.steps.every((step, index) => {
      if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true
      if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return false
      const doc = transaction.docs[index]!
      const from = doc.resolve(step.from), to = doc.resolve(step.to)
      if (!from.parent.isTextblock || !from.sameParent(to)) return false
      let inline = true
      step.slice.content.forEach(node => { if (!node.isInline) inline = false })
      return inline
    })
  }
  return new Plugin({
    state: {
      init(_config, state) { valid(state.doc); return null },
      apply(transaction, value, oldState, newState) {
        if (transaction.docChanged && validDocuments.has(oldState.doc) && preservesIds(transaction)) validDocuments.add(newState.doc)
        return value
      },
    },
    props: {
      // 在插入之前移除副本 ID，避免粘贴到原块前方时让原块失去身份。
      transformPasted(slice, view) {
        // ProseMirror 的内部拖动也经过此钩子；移动现有块须保留原身份。
        if (view.dragging) return slice
        return new Slice(clearCopiedBlockIds(slice.content), slice.openStart, slice.openEnd)
      },
    },
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null
      // 只跳过远端事务本身；其后 TrailingNode 等插件本地追加的节点仍须分配 ID。
      // 不能沿 appendedTransaction 回溯来源，否则自动补出的空段落会缺少 ID。
      if (transactions.every(transaction => !transaction.docChanged || isChangeOrigin(transaction))) return null

      // 已核验的文档中，段内字符和 marks 不改变块集合；保留结构操作的完整校验。
      if (validDocuments.has(newState.doc)) return null

      const transaction = createBlockIdTransaction(newState, oldState.doc)
      validDocuments.add(transaction?.doc ?? newState.doc)
      if (!transaction) return null

      // Yjs 在全部 appendTransaction 完成后才同步一次，并读取最后一次正文事务的
      // addToHistory。修正必须继承本次操作的历史语义，否则整次新增/拆分都会被排除。
      // ProseMirror 会把追加事务合入原操作，不会多出一次“撤销 ID”的步骤。
      transaction.setMeta('addToHistory', transactions.some(tr =>
        tr.docChanged && tr.getMeta('addToHistory') !== false && rootTransaction(tr).getMeta('addToHistory') !== false,
      ))
      return transaction
    },
  })
}

export const BlockId = Extension.create({
  name: 'blockId',

  onCreate() {
    if (!this.editor.isEditable) return
    // 旧本机备份可能已包含缺失 ID 的段落。沿原 Yjs 文档补交修复，保留原事件与撤销边界。
    const transaction = createBlockIdTransaction(this.editor.state)
    if (transaction) this.editor.view.dispatch(transaction.setMeta('addToHistory', false))
  },

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_NODE_TYPES],
        attributes: {
          diffId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-diff-id'),
            renderHTML: (attributes) => {
              if (!attributes.diffId) return {}
              return { 'data-diff-id': attributes.diffId }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [createBlockIdPlugin()]
  },
})
