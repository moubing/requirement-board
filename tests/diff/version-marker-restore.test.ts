// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockId } from '../../app/components/editor/tiptap-extensions'
import { createAnnotationEditGuard } from '../../app/components/editor/annotation-edit-guard'
import { restoreVersionChange } from '../../app/components/editor/version-marker-restore'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { buildVersionMarkers } from '../../shared/diff/version-markers'
import type { RichTextDocument } from '../../shared/editor/document'
import type { AiAnnotation } from '../../shared/agent/annotations'
import { captureAnnotation } from '../../app/components/editor/annotation-capture'

vi.mock('../../app/components/editor/RequirementImageNode.vue', () => ({ default: {} }))
vi.mock('../../app/components/editor/RequirementCalloutNode.vue', () => ({ default: {} }))
const editors: Editor[] = [], documents: Y.Doc[] = []
const base: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'a' }, content: [{ type: 'text', text: '原来的文字' }] }] }
afterEach(() => { editors.splice(0).forEach(e => e.destroy()); documents.splice(0).forEach(d => d.destroy()) })
describe.each([false, true])('单块恢复事务（协作：%s）', collaborative => {
  it('保留本人输入的前一步，恢复可独立撤销/重做，不修改基线', () => {
    const document = createCollaborationDocument({ title: '测试', contentJson: structuredClone(base) })
    documents.push(document)
    const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId,
      ...(collaborative ? [Collaboration.configure({ document })] : [])], content: collaborative ? undefined : structuredClone(base) })
    editors.push(editor)
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('我的修改')
    const edited = editor.getJSON() as RichTextDocument
    const marker = buildVersionMarkers(buildRichTextDiff(base, edited).pairs)[0]!
    expect(restoreVersionChange(editor, base, marker)).toBe(true)
    expect(editor.getText()).toBe('原来的文字')
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(edited)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getText()).toBe('原来的文字')
    expect(base.content[0]!.content![0]!.text).toBe('原来的文字')
  })
  it('受影响的 AI 标注先确认；取消保持 JSON 与历史，确认只应用一次', async () => {
    const target = structuredClone(base)
    target.content[0]!.content![0]!.text = '修改后的文字'
    let notes: AiAnnotation[] = []
    const request = vi.fn()
    const guard = createAnnotationEditGuard({ enabled: () => true, annotations: () => notes, request,
      remove: ids => { notes = notes.filter(note => !ids.includes(note.id)) }, stale: vi.fn() })
    const document = createCollaborationDocument({ title: '测试', contentJson: target })
    documents.push(document)
    const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId, guard.extension,
      ...(collaborative ? [Collaboration.configure({ document })] : [])], content: collaborative ? undefined : target })
    editors.push(editor)
    editor.commands.setTextSelection({ from: 1, to: 4 })
    notes.push({ ...captureAnnotation(editor), id: 'note', comment: '要求' })
    const before = editor.getJSON()
    const marker = buildVersionMarkers(buildRichTextDiff(base, before as RichTextDocument).pairs)[0]!
    restoreVersionChange(editor, base, marker)
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(['note']))
    expect(editor.getJSON()).toEqual(before)
    guard.cancel()
    expect(editor.getJSON()).toEqual(before)
    restoreVersionChange(editor, base, marker)
    await new Promise(resolve => setTimeout(resolve, 0))
    guard.confirm()
    expect(editor.getText()).toBe('原来的文字')
    expect(notes).toEqual([])
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
  })
})
