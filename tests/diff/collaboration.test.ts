// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'
import { createCollaborationDocument, readCollaborationDocument, updateCollaborativeTitle } from '../../shared/collaboration/document'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { captureCollaborativePosition, restoreCollaborativePosition } from '../../app/components/editor/collaboration-positions'
import { addImageUploadPlaceholder, findImageUploadPlaceholderPosition, ImageUploadPlaceholder } from '../../app/components/editor/image-upload-placeholder'

const editors: Editor[] = []
const docs: Y.Doc[] = []
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); docs.splice(0).forEach(doc => doc.destroy()) })
function fixture() {
  const seed = createCollaborationDocument({ title: '标题', contentJson: {
    type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'paragraph_shared' }, content: [{ type: 'text', text: '共同正文' }] }],
  } })
  const create = () => {
    const doc = new Y.Doc(); Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed)); docs.push(doc)
    const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: false }), BlockId, ImageUploadPlaceholder, Collaboration.configure({ document: doc })] })
    editors.push(editor)
    return { doc, editor }
  }
  const a = create(), b = create()
  docs.push(seed)
  const merge = () => {
    const left = Y.encodeStateAsUpdate(a.doc), right = Y.encodeStateAsUpdate(b.doc)
    Y.applyUpdate(a.doc, right); Y.applyUpdate(b.doc, left)
  }
  return { a, b, merge }
}

describe('实时协作合并', () => {
  it('同一段落离线插入不同内容后收敛，撤销只撤自己的输入', () => {
    const { a, b, merge } = fixture()
    a.editor.commands.insertContentAt(1, '甲')
    b.editor.commands.insertContentAt(1, '乙')
    merge()
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
    expect(a.editor.getText()).toContain('甲')
    expect(a.editor.getText()).toContain('乙')
    a.editor.commands.undo()
    merge()
    expect(a.editor.getText()).not.toContain('甲')
    expect(b.editor.getText()).toContain('乙')
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
  })

  it('标题按字符合并，持久化后重开和再次同步不会重复正文', () => {
    const { a, b, merge } = fixture()
    updateCollaborativeTitle(a.doc.getText('title'), '甲标题')
    updateCollaborativeTitle(b.doc.getText('title'), '标题乙')
    merge()
    expect(readCollaborationDocument(a.doc).title).toBe('甲标题乙')
    const reopened = new Y.Doc(); docs.push(reopened)
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a.doc))
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(b.doc))
    expect(readCollaborationDocument(reopened)).toEqual(readCollaborationDocument(a.doc))
  })

  it('双方同时插入块后保留唯一稳定的 diffId', () => {
    const { a, b, merge } = fixture()
    a.editor.commands.insertContentAt(a.editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: '甲的新段落' }] })
    b.editor.commands.insertContentAt(b.editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: '乙的新段落' }] })
    merge()
    expect(a.editor.getJSON()).toEqual(b.editor.getJSON())
    const ids = a.editor.getJSON().content!.map(node => node.attrs!.diffId)
    expect(new Set(ids).size).toBe(3)
    expect(ids.every(Boolean)).toBe(true)
    expect(ids[0]).toBe('paragraph_shared')
  })

  it('待上传图片的相对位置随远端插入移动', () => {
    const { a, b, merge } = fixture()
    const end = a.editor.state.doc.content.size - 1
    const relative = captureCollaborativePosition(a.editor, a.doc, end)
    addImageUploadPlaceholder(a.editor.view, { id: 'upload_pending', fileName: '图片.png', status: 'uploading', order: 1 }, end)
    b.editor.commands.insertContentAt(1, '新插入')
    merge()
    expect(restoreCollaborativePosition(a.editor, a.doc, relative, end)).toBe(end + 3)
    expect(findImageUploadPlaceholderPosition(a.editor.view, 'upload_pending')).toBe(end + 3)
  })
})
