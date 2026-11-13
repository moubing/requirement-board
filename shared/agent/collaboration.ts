import type { Doc } from 'yjs'
import { initProseMirrorDoc, updateYFragment } from '@tiptap/y-tiptap'
import { Fragment } from '@tiptap/pm/model'
import { richTextProseMirrorSchema } from '../editor/validation'
import { COLLABORATION_FIELD, collaborationFingerprint, readCollaborationDocument, updateCollaborativeTitle } from '../collaboration/document'
import type { DocumentSnapshot } from './suggestions'

/** Edit an existing binary-restored Y.Doc. Never create a replacement CRDT from JSON. */
export function applyCandidateToYDocument(document: Doc, candidate: DocumentSnapshot) {
  const fragment = document.getXmlFragment(COLLABORATION_FIELD)
  const { doc, meta } = initProseMirrorDoc(fragment, richTextProseMirrorSchema)
  const target = richTextProseMirrorSchema.nodeFromJSON(candidate.contentJson)
  const nodes = new Map<string, typeof doc>()
  doc.forEach(node => nodes.set(node.attrs.diffId, node))
  const children: (typeof doc)[] = []
  target.forEach(node => {
    const previous = nodes.get(node.attrs.diffId)
    children.push(previous?.eq(node) ? previous : node)
  })
  document.transact(() => {
    updateYFragment(document, fragment, doc.copy(Fragment.fromArray(children)), meta)
    updateCollaborativeTitle(document.getText('title'), candidate.title)
  }, 'agent-suggestion')
  if (collaborationFingerprint(readCollaborationDocument(document)) !== collaborationFingerprint(candidate)) {
    throw new Error('应用结果与待执行内容不一致')
  }
}
