import { combineTransactionSteps, getChangedRanges } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'

function numberingType(node: ProseMirrorNode) {
  return !node.attrs.type || node.attrs.type === '1' ? null : node.attrs.type
}

export function createOrderedListPastePlugin() {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      const paste = transactions.find(transaction => transaction.docChanged && transaction.getMeta('uiEvent') === 'paste')
      if (!paste) return null

      const ranges = getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions])).map(change => change.newRange)
      const joins: number[] = []
      const collect = (parent: ProseMirrorNode, contentStart: number) => {
        let previous: ProseMirrorNode | undefined
        let runStart = contentStart
        let runEnd = contentStart
        let boundaries: number[] = []
        const finish = () => {
          // 只规范本次粘贴触及的连续列表，不重写文档其他位置的已有结构。
          if (ranges.some(range => range.from <= runEnd && range.to >= runStart)) joins.push(...boundaries)
          boundaries = []
        }
        parent.forEach((node, offset) => {
          const position = contentStart + offset
          if (node.type.name === 'orderedList') {
            if (previous?.type === node.type && numberingType(previous) === numberingType(node)) boundaries.push(position)
            else { finish(); runStart = position }
            runEnd = position + node.nodeSize
          } else finish()
          previous = node
        })
        finish()
      }

      collect(newState.doc, 0)
      newState.doc.descendants((node, position) => { if (!node.isLeaf) collect(node, position + 1) })
      const transaction = newState.tr
      // 从后向前合并，前面的边界位置不会因后面的合并而改变。
      for (const position of joins.sort((a, b) => b - a)) {
        if (canJoin(transaction.doc, position)) transaction.join(position)
      }
      if (!transaction.docChanged) return null
      // 与粘贴共用一次撤销；Yjs 会读取最后一个追加事务的历史标记。
      return transaction.setMeta('addToHistory', paste.getMeta('addToHistory') !== false)
    },
  })
}
