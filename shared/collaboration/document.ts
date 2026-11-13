import * as Y from 'yjs'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import { z } from 'zod'
import { draftFingerprint } from '../drafts/document'
import { draftDocumentSchema } from '../drafts/validation'
import { richTextProseMirrorSchema } from '../editor/validation'
import { createDiffId, ensureBlockIds, type RichTextDocument } from '../editor/document'

export const COLLABORATION_FIELD = 'default'
export const collaborationSnapshotSchema = z.object({ title: z.string().max(240), contentJson: draftDocumentSchema }).strict()
export interface CollaborationSnapshot { title: string; contentJson: RichTextDocument }

export function createCollaborationDocument(snapshot: CollaborationSnapshot) {
  const doc = prosemirrorJSONToYDoc(richTextProseMirrorSchema, ensureBlockIds(snapshot.contentJson), COLLABORATION_FIELD)
  doc.getText('title').insert(0, snapshot.title)
  return doc
}

export function readCollaborationDocument(doc: Y.Doc): CollaborationSnapshot {
  const json = yDocToProsemirrorJSON(doc, COLLABORATION_FIELD)
  return { title: doc.getText('title').toString(), contentJson: richTextProseMirrorSchema.nodeFromJSON(json).toJSON() as RichTextDocument }
}

// 对已有协作历史仅追加一个节点，禁止从 JSON 重建 Y.Doc；调用方在监听本地编辑之前完成。
export function ensureCollaborationTrailingParagraph(doc: Y.Doc) {
  const fragment = doc.getXmlFragment(COLLABORATION_FIELD)
  const last = fragment.length ? fragment.get(fragment.length - 1) : null
  if (!(last instanceof Y.XmlElement) || last.nodeName === 'paragraph') return false
  const paragraph = new Y.XmlElement('paragraph')
  paragraph.setAttribute('diffId', createDiffId('para'))
  doc.transact(() => fragment.push([paragraph]), 'trailing-paragraph-normalization')
  return true
}

export function collaborationFingerprint(snapshot: CollaborationSnapshot) {
  return draftFingerprint({ ...snapshot, baseRevisionId: '', changeNote: '', pendingUploads: [] })
}

export async function collaborationSignature(snapshot: CollaborationSnapshot) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(collaborationFingerprint(snapshot)))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

// 只替换输入框实际改变的范围，使标题也能按字符合并。
export function updateCollaborativeTitle(text: Y.Text, next: string) {
  const previous = text.toString()
  if (previous === next) return
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  let end = 0
  while (end < previous.length - start && end < next.length - start && previous[previous.length - end - 1] === next[next.length - end - 1]) end++
  text.doc!.transact(() => {
    text.delete(start, previous.length - start - end)
    text.insert(start, next.slice(start, next.length - end))
  }, 'title-input')
}

export function encodeCollaborationState(doc: Y.Doc) {
  const bytes = Y.encodeStateAsUpdate(doc)
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

export function decodeCollaborationState(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}
