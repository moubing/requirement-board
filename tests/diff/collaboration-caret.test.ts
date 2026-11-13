// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { expect, it, vi } from 'vitest'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import { RequirementCollaborationCaret } from '../../app/components/editor/collaboration-caret-extension'
import { captureCollaborativePosition } from '../../app/components/editor/collaboration-positions'
import { BlockId } from '../../app/components/editor/block-id-extension'

it('编辑副本与 Provider 身份不同，光标仍排除自己、显示其他编辑会话，并清理订阅', async () => {
  const doc = createCollaborationDocument({ title: '标题', contentJson: { type: 'doc', content: [
    { type: 'paragraph', attrs: { diffId: 'p_caret' }, content: [{ type: 'text', text: '共同文字' }] },
  ] } })
  const providerDoc = new Y.Doc(), remoteDoc = new Y.Doc()
  Y.applyUpdate(providerDoc, Y.encodeStateAsUpdate(doc))
  const awareness = new Awareness(providerDoc), remote = new Awareness(remoteDoc)
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: [StarterKit.configure({ undoRedo: false }), BlockId,
    Collaboration.configure({ document: doc }),
    RequirementCollaborationCaret.configure({ provider: { awareness }, user: { name: '自己', color: '#123456' } }),
  ] })
  try {
    expect(awareness.clientID).not.toBe(doc.clientID)
    editor.view.focus()
    editor.commands.setTextSelection(2)
    const position = JSON.parse(captureCollaborativePosition(editor, doc, 2)!)
    remote.setLocalState({ user: { name: '同事', color: '#654321' }, cursor: { anchor: position, head: position }, editing: true })
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remote, [remote.clientID]), 'test')
    await vi.waitFor(() => expect([...element.querySelectorAll('.collaboration-carets__label')].map(node => node.textContent)).toEqual(['同事']))
    remote.setLocalStateField('editing', false)
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remote, [remote.clientID]), 'test')
    await vi.waitFor(() => expect(element.querySelectorAll('.collaboration-carets__label')).toHaveLength(0))
  } finally {
    const storage = editor.storage.collaborationCaret
    editor.destroy()
    awareness.destroy(); remote.destroy()
    doc.destroy(); providerDoc.destroy(); remoteDoc.destroy(); element.remove()
    expect(storage.users).toEqual([])
  }
})
