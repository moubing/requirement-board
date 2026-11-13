// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockId } from '../../app/components/editor/block-id-extension'
import { CollaborationEditQueue, CollaborationEditRecorder } from '../../app/utils/collaboration-edit-queue'
import { applyCandidateToYDocument } from '../../shared/agent/collaboration'
import { collaborationSnapshotSchema, createCollaborationDocument, decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import { draftDocumentSchema } from '../../shared/drafts/validation'
import type { RichTextDocument } from '../../shared/editor/document'

const editors: Editor[] = []
const documents: Y.Doc[] = []

function createDocument(contentJson: RichTextDocument) {
  const doc = createCollaborationDocument({ title: '使用手册', contentJson })
  documents.push(doc)
  return doc
}

function createEditor(doc: Y.Doc, editable = true) {
  const editor = new Editor({ editable, extensions: [
    StarterKit.configure({ undoRedo: false }), BlockId, Collaboration.configure({ document: doc }),
  ] })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  documents.splice(0).forEach(doc => doc.destroy())
})

describe('协作加载后的块标识', () => {
  it('只读页面不补交旧备份的 ID 修复', async () => {
    const doc = createDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'para_saved' } }] })
    doc.getXmlFragment('default').push([new Y.XmlElement('paragraph')])
    const before = Y.encodeStateAsUpdate(doc)
    createEditor(doc, false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before)
  })

  it('旧本机检查点中缺失 ID 的段落在重开后可随原事件补交，不改正文或已有 ID', async () => {
    const server = createDocument({ type: 'doc', content: [
      { type: 'paragraph', attrs: { diffId: 'para_saved' }, content: [{ type: 'text', text: '已采纳的正文' }] },
    ] })
    const restored = new Y.Doc()
    documents.push(restored)
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(server))
    const queue = new CollaborationEditQueue(async edits => {
      for (const edit of edits) Y.applyUpdate(server, decodeCollaborationState(edit.update))
      expect(collaborationSnapshotSchema.safeParse(readCollaborationDocument(server)).success).toBe(true)
    })
    const recorder = new CollaborationEditRecorder(queue)
    restored.on('update', (update, _origin, _doc, transaction) => {
      if (transaction.local) recorder.record(update, restored.clientID, 'edit')
    })
    // 模拟旧版浏览器已备份、尚未被服务端接受的末尾空段落。
    restored.getXmlFragment('default').push([new Y.XmlElement('paragraph')])
    recorder.flush()
    const originalEvent = queue.snapshot()[0]
    const editor = createEditor(restored)
    await new Promise(resolve => setTimeout(resolve, 0))
    recorder.flush()

    expect(queue.snapshot()[0]).toEqual(originalEvent)
    expect(collaborationSnapshotSchema.safeParse(readCollaborationDocument(restored)).success).toBe(true)
    expect(editor.getText().trim()).toBe('已采纳的正文')
    expect(editor.state.doc.firstChild?.attrs.diffId).toBe('para_saved')
    expect(editor.can().undo()).toBe(false)
    await queue.flush()
    expect(queue.size).toBe(0)
    expect(readCollaborationDocument(server)).toEqual(readCollaborationDocument(restored))
  })

  it.each(['首次加载', '已打开页面接收建议'])('%s：末尾列表自动补出的段落可以直接同步保存', async mode => {
    const source = createDocument({ type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'para_initial' } }] })
    const candidate = readCollaborationDocument(createDocument({ type: 'doc', content: [
      { type: 'heading', attrs: { diffId: 'heading_read_more', level: 2 }, content: [{ type: 'text', text: '继续阅读' }] },
      { type: 'bulletList', attrs: { diffId: 'list_read_more' }, content: [
        { type: 'listItem', attrs: { diffId: 'item_manual' }, content: [
          { type: 'paragraph', attrs: { diffId: 'para_manual' }, content: [{ type: 'text', text: '使用手册 01｜快速入门' }] },
        ] },
      ] },
    ] }))
    if (mode === '首次加载') applyCandidateToYDocument(source, candidate)
    const local = new Y.Doc()
    documents.push(local)
    Y.applyUpdate(local, Y.encodeStateAsUpdate(source))
    const editor = createEditor(local)
    await new Promise(resolve => setTimeout(resolve, 0))
    if (mode === '已打开页面接收建议') {
      applyCandidateToYDocument(source, candidate)
      Y.applyUpdate(local, Y.encodeStateAsUpdate(source))
    }

    expect(draftDocumentSchema.safeParse(editor.getJSON()).success).toBe(true)
    const trailing = editor.state.doc.lastChild!
    expect(trailing.type.name).toBe('paragraph')
    expect(trailing.attrs.diffId).toEqual(expect.any(String))
    expect(trailing.attrs.diffId).not.toBe('')

    // 不输入正文，仅移动光标；Yjs 此时也必须能通过保存端使用的校验。
    editor.commands.setTextSelection(2)
    const saved = readCollaborationDocument(local)
    expect(collaborationSnapshotSchema.safeParse(saved).success).toBe(true)
    expect(saved.contentJson.content.slice(0, -1)).toEqual(candidate.contentJson.content)
    expect(saved.contentJson.content.at(-1)?.attrs?.diffId).toBe(trailing.attrs.diffId)
    expect(editor.can().undo()).toBe(false)

    // 持久化二进制重开，保持原块身份；再次同步不会增加段落或重写 ID。
    Y.applyUpdate(source, Y.encodeStateAsUpdate(local))
    const reopened = new Y.Doc()
    documents.push(reopened)
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(source))
    const reopenedEditor = createEditor(reopened)
    reopenedEditor.commands.setTextSelection(2)
    Y.applyUpdate(local, Y.encodeStateAsUpdate(reopened))
    expect(readCollaborationDocument(reopened)).toEqual(saved)
    expect(editor.getJSON()).toEqual(reopenedEditor.getJSON())
  })
})
