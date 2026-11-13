import { cloneRichTextDocument, createEmptyDocument, type RichTextDocument, type RichTextNode } from '../editor/document'
import type { DiffBlockPair, DiffStatus } from './rich-text-diff'
import { isListNodeType, listItemType } from '../editor/task-list'

export type RevertibleDiffStatus = Exclude<DiffStatus, 'unchanged'>

export interface RevertChangePayload {
  status: RevertibleDiffStatus
  pairs: DiffBlockPair[]
}

export interface RevertDraftChangeResult {
  document: RichTextDocument
  changed: boolean
}

interface NodeLocation {
  nodes: RichTextNode[]
  index: number
  node: RichTextNode
  path: number[]
}

export function revertDraftChange(
  draftDocument: RichTextDocument,
  baseDocument: RichTextDocument,
  payload: RevertChangePayload,
): RevertDraftChangeResult {
  const draft = cloneRichTextDocument(draftDocument)
  const base = cloneRichTextDocument(baseDocument)
  const nextContent = [...(draft.content ?? [])]
  let changed = false

  if (payload.status === 'inserted') {
    changed = removeTargetBlocks(nextContent, payload.pairs)
  } else if (payload.status === 'deleted') {
    changed = insertBaseBlocks(nextContent, base, payload.pairs)
  } else {
    changed = replaceModifiedBlocks(nextContent, base, payload.pairs)
  }

  return {
    document: {
      type: 'doc',
      content: nextContent.length ? nextContent : createEmptyDocument().content,
    },
    changed,
  }
}

function removeTargetBlocks(contentNodes: RichTextNode[], pairs: DiffBlockPair[]) {
  let changed = false
  const targetIds = pairs.map((pair) => pair.target?.id).filter((id): id is string => Boolean(id))

  for (const targetId of targetIds) {
    changed = removeNodeById(contentNodes, targetId) || changed
  }

  if (changed) pruneEmptyLists(contentNodes)
  return changed
}

function insertBaseBlocks(contentNodes: RichTextNode[], baseDocument: RichTextDocument, pairs: DiffBlockPair[]) {
  let changed = false

  for (const pair of pairs) {
    const baseBlock = pair.base
    if (!baseBlock || findNodeLocationById(contentNodes, baseBlock.id)) continue

    const parentId = baseBlock.list?.parentId
    if (parentId) {
      const draftParent = findNodeLocationById(contentNodes, parentId)
      const baseParent = findNodeLocationById(baseDocument.content ?? [], parentId)
      const draftParentContent = draftParent?.node.content
      const baseParentContent = baseParent?.node.content

      if (!baseParent || !baseParentContent) continue
      if (!draftParent || !isListNodeType(draftParent.node.type)) {
        // 整个列表被删后，先按父块的相邻 ID 重建容器；只恢复所选项。
        const restored = cloneRichTextNode(baseParent.node)
        restored.content = [cloneRichTextNode(baseBlock.node)]
        if (draftParent) draftParent.nodes.splice(draftParent.index, 1, restored)
        else {
          const insertIndex = findInsertionIndex(contentNodes, baseDocument.content ?? [], parentId, [], [])
          contentNodes.splice(insertIndex, 0, restored)
        }
        changed = true
        continue
      }
      if (!draftParentContent) continue
      restoreListContainer(draftParent.node, baseParent.node)

      const insertIndex = findInsertionIndex(
        draftParentContent,
        baseParentContent,
        baseBlock.id,
        baseParent.path,
        draftParent.path,
      )
      draftParentContent.splice(insertIndex, 0, cloneRichTextNode(baseBlock.node))
      changed = true
      continue
    }

    const insertIndex = findInsertionIndex(contentNodes, baseDocument.content ?? [], baseBlock.id, [], [])
    contentNodes.splice(insertIndex, 0, cloneRichTextNode(baseBlock.node))
    changed = true
  }

  return changed
}

function replaceModifiedBlocks(contentNodes: RichTextNode[], baseDocument: RichTextDocument, pairs: DiffBlockPair[]) {
  let changed = false

  for (const pair of pairs) {
    const baseNode = pair.base?.node
    const targetId = pair.target?.id
    if (!baseNode || !targetId) continue

    const target = findNodeLocationById(contentNodes, targetId)
    if (target) {
      const baseList = pair.base?.list, targetList = pair.target?.list
      if (baseList && targetList) {
        const parent = findNodeLocationById(contentNodes, targetList.parentId)?.node
        const baseParent = findNodeLocationById(baseDocument.content, baseList.parentId)?.node
        if (parent && baseParent) changed = restoreListContainer(parent, baseParent) || changed
      }
      if (sameNode(target.node, baseNode)) continue

      target.nodes.splice(target.index, 1, cloneRichTextNode(baseNode))
      changed = true
      continue
    }

    changed = insertBaseBlocks(contentNodes, baseDocument, [pair]) || changed
  }

  return changed
}

function restoreListContainer(parent: RichTextNode, baseParent: RichTextNode) {
  if (!isListNodeType(baseParent.type) || (parent.type === baseParent.type && JSON.stringify({ ...parent.attrs, diffId: undefined }) === JSON.stringify({ ...baseParent.attrs, diffId: undefined }))) return false
  // 类型和起号属于共享容器；恢复单项也必须保证其他条目的类型仍符合容器 schema。
  parent.type = baseParent.type
  parent.attrs = { ...baseParent.attrs, diffId: parent.attrs?.diffId }
  const itemType = listItemType(baseParent.type)
  for (const item of parent.content ?? []) {
    if (item.type === itemType) continue
    item.type = itemType
    if (itemType === 'taskItem') {
      const original = baseParent.content?.find(node => node.attrs?.diffId === item.attrs?.diffId)
      item.attrs = { ...item.attrs, checked: original?.attrs?.checked === true }
    } else if (item.attrs) delete item.attrs.checked
  }
  return true
}

function removeNodeById(contentNodes: RichTextNode[], id: string) {
  const target = findNodeLocationById(contentNodes, id)
  if (!target) return false

  target.nodes.splice(target.index, 1)
  return true
}

function findNodeLocationById(
  nodes: RichTextNode[],
  id: string,
  parentPath: number[] = [],
): NodeLocation | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const path = [...parentPath, index]
    if (blockId(node, path) === id) {
      return { nodes, index, node, path }
    }

    if (node.content?.length) {
      const nested = findNodeLocationById(node.content, id, path)
      if (nested) return nested
    }
  }

  return null
}

function findInsertionIndex(
  draftNodes: RichTextNode[],
  baseNodes: RichTextNode[],
  firstBaseId: string,
  baseParentPath: number[],
  draftParentPath: number[],
) {
  const baseIndex = baseNodes.findIndex((node, index) => blockId(node, [...baseParentPath, index]) === firstBaseId)
  if (baseIndex === -1) return draftNodes.length

  for (let index = baseIndex - 1; index >= 0; index -= 1) {
    const previousId = blockId(baseNodes[index]!, [...baseParentPath, index])
    const draftIndex = draftNodes.findIndex((node, nodeIndex) => blockId(node, [...draftParentPath, nodeIndex]) === previousId)
    if (draftIndex !== -1) return draftIndex + 1
  }

  for (let index = baseIndex + 1; index < baseNodes.length; index += 1) {
    const nextId = blockId(baseNodes[index]!, [...baseParentPath, index])
    const draftIndex = draftNodes.findIndex((node, nodeIndex) => blockId(node, [...draftParentPath, nodeIndex]) === nextId)
    if (draftIndex !== -1) return draftIndex
  }

  return draftNodes.length
}

function pruneEmptyLists(nodes: RichTextNode[]) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!
    if (node.content?.length) pruneEmptyLists(node.content)

    if (isListNodeType(node.type) && !node.content?.some((child) => child.type === listItemType(node.type as 'bulletList' | 'orderedList' | 'taskList'))) {
      nodes.splice(index, 1)
    }
  }
}

function blockId(node: RichTextNode, path: number[]) {
  return typeof node.attrs?.diffId === 'string' && node.attrs.diffId ? node.attrs.diffId : `${node.type}_${path.join('_')}`
}

function cloneRichTextNode(node: RichTextNode) {
  return JSON.parse(JSON.stringify(node)) as RichTextNode
}

function sameNode(left: RichTextNode, right: RichTextNode) {
  return JSON.stringify(left) === JSON.stringify(right)
}
