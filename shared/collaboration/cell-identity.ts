import * as Y from 'yjs'
import { createDiffId } from '../editor/document'
import { COLLABORATION_FIELD } from './document'

/** 受控升级专用：在原 CRDT 上补单元格身份，不重建节点或历史。 */
export function upgradeCollaborativeCellIds(doc: Y.Doc) {
  const seen = new Set<string>()
  const missing: Y.XmlElement[] = []
  function visit(parent: Y.XmlFragment | Y.XmlElement) {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      const id = child.getAttribute('diffId')
      if (id) {
        if (seen.has(id)) throw new Error('共同草稿存在重复 ID，无法安全升级')
        seen.add(id)
      } else if (child.nodeName === 'tableCell' || child.nodeName === 'tableHeader') missing.push(child)
      visit(child)
    }
  }
  visit(doc.getXmlFragment(COLLABORATION_FIELD))
  doc.transact(() => {
    for (const cell of missing) {
      let id: string
      do { id = createDiffId('cell') } while (seen.has(id))
      seen.add(id)
      cell.setAttribute('diffId', id)
    }
  }, 'document-schema-3-upgrade')
  return missing.length
}
