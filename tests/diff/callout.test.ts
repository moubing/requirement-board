// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockId, Callout } from '../../app/components/editor/tiptap-extensions'
import { setCalloutTone } from '../../app/components/editor/callout-commands'
import { createAnnotationEditGuard } from '../../app/components/editor/annotation-edit-guard'
import { captureNodeTarget, type AiAnnotation } from '../../shared/agent/annotations'
import { agentRequestSchema } from '../../shared/agent/suggestions'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import { calloutToneChange, calloutTones, displayCalloutTone } from '../../shared/editor/callout'
import { extractPlainText, type RichTextDocument } from '../../shared/editor/document'
import { parseRichTextDocument } from '../../shared/editor/validation'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'

vi.mock('../../app/components/editor/RequirementImageNode.vue', () => ({ default: {} }))
vi.mock('../../app/components/editor/RequirementCalloutNode.vue', () => ({ default: {} }))
const editors: Editor[] = [], docs: Y.Doc[] = []
const sample = (tone: unknown = 'note'): RichTextDocument => ({ type: 'doc', content: [
  { type: 'callout', attrs: { diffId: 'call', tone }, content: [{ type: 'text', text: '同一内容', marks: [{ type: 'bold' }] }] },
  { type: 'paragraph', attrs: { diffId: 'end' } },
] })
afterEach(() => { editors.splice(0).forEach(e => e.destroy()); docs.splice(0).forEach(d => d.destroy()) })

describe('提示块契约', () => {
  it.each(calloutTones)('接收 %s，HTML 往返和纯文本保持原内容', tone => {
    const content = sample(tone)
    expect(parseRichTextDocument(content)).toEqual(content)
    expect(extractPlainText(content)).toBe('同一内容')
    const editor = new Editor({ extensions: [StarterKit, BlockId, Callout], content })
    editors.push(editor)
    const container = document.createElement('div')
    container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
    expect(container.querySelector('section')?.dataset.tone).toBe(tone)
    expect(container.querySelector('button, svg')).toBeNull()
    expect(DOMParser.fromSchema(editor.schema).parse(container).toJSON()).toEqual(editor.getJSON())
  })
  it.each(['info', 'success', '', null, 123])('网页和 AI 共用校验拒绝非法 tone：%s', tone => {
    expect(() => parseRichTextDocument(sample(tone))).toThrow('Callout tone must be note, tip, warning, or danger')
    expect(agentRequestSchema.safeParse({ action: 'create', requestId: 'request_callout_tone', title: '提示块', changeNote: '创建', contentJson: sample(tone) }).success).toBe(false)
  })
  it('缺少语气可读取，未知语气只在展示时回退，不改写数据', () => {
    const missing = sample(); delete missing.content[0]!.attrs!.tone
    expect(parseRichTextDocument(missing)).toEqual(missing)
    const legacy = sample('legacy')
    expect(displayCalloutTone(legacy.content[0]!.attrs!.tone)).toBe('note')
    expect(legacy.content[0]!.attrs!.tone).toBe('legacy')
  })
  it('语气变化计入 Diff、有明确说明，恢复只改草稿', () => {
    const base = sample('note'), target = sample('warning')
    const pair = buildRichTextDiff(base, target).pairs[0]!
    expect(pair.status).toBe('modified')
    expect(calloutToneChange(pair.base?.node, pair.target?.node)).toBe('语气：说明 → 注意')
    expect(pair.baseChunks).toEqual(pair.targetChunks)
    expect(revertDraftChange(target, base, { status: 'modified', pairs: [pair] }).document).toEqual(base)
    expect(target.content[0]!.attrs!.tone).toBe('warning')
  })
  it('Diff 保留行内格式与真实换行，不在文字节点之间添加换行', () => {
    const base = sample()
    base.content[0]!.content = [
      { type: 'text', text: '普通' }, { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' }, { type: 'text', text: '下一行' },
    ]
    const target = structuredClone(base)
    target.content[0]!.attrs!.tone = 'tip'
    const pair = buildRichTextDiff(base, target).pairs[0]!
    expect(pair.base!.text).toBe('普通加粗\n下一行')
    expect(pair.targetChunks.map(chunk => chunk.value).join('')).toBe('普通加粗\n下一行')
    expect(pair.baseChunks).toEqual(pair.targetChunks)
    expect(pair.targetChunks.find(chunk => chunk.value === '加粗')?.marks).toEqual([{ type: 'bold' }])
  })
})

describe.each([false, true])('提示类型操作（协作：%s）', collaborative => {
  function mount(content = sample(), guard?: ReturnType<typeof createAnnotationEditGuard>) {
    const doc = createCollaborationDocument({ title: '提示块', contentJson: content }); docs.push(doc)
    const editor = new Editor({ extensions: [StarterKit.configure({ undoRedo: collaborative ? false : {} }), BlockId, Callout,
      ...(guard ? [guard.extension] : []), ...(collaborative ? [Collaboration.configure({ document: doc })] : [])], content: collaborative ? undefined : content })
    editors.push(editor)
    return editor
  }
  it('修改语气保留选区、文字和身份，前后输入与语气可各自撤销', () => {
    const editor = mount()
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('前')
    const before = editor.getJSON(), selection = editor.state.selection.toJSON()
    expect(setCalloutTone(editor, 'call', 'tip')).toBe(true)
    const switched = editor.getJSON()
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(switched.content![0]!.content).toEqual(before.content![0]!.content)
    editor.commands.insertContent('后')
    editor.commands.undo(); expect(editor.getJSON()).toEqual(switched)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(sample())
    editor.commands.redo(); editor.commands.redo()
    expect(editor.getJSON()).toEqual(switched)
    editor.setEditable(false)
    expect(setCalloutTone(editor, 'call', 'danger')).toBe(false)
  })
  it('新块替换空段，在非空段后插入；拒绝非法命令参数', () => {
    const editor = mount({ type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p' }, content: [{ type: 'text', text: '保留整段' }] }] })
    editor.commands.setTextSelection(2)
    expect(editor.commands.insertCallout({ tone: 'warning' })).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe('保留整段')
    expect(editor.state.selection.$from.parent.type.name).toBe('callout')
    expect(editor.state.selection.$from.parent.textContent).toBe('')
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(editor.commands.insertCallout({ tone: 'danger' })).toBe(true)
    // BlockId 的既有尾段规范化会在提示块后补一个可续写段落。
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild!.attrs.tone).toBe('danger')
    // 故意模拟 JS/外部调用绕过 TypeScript。
    expect(editor.commands.insertCallout({ tone: 'info' as never })).toBe(false)
  })
  it('整体标注确认前不改正文；取消保留，确认可独立撤销', async () => {
    let notes: AiAnnotation[] = []
    const request = vi.fn()
    const guard = createAnnotationEditGuard({ enabled: () => true, annotations: () => notes, request,
      remove: ids => { notes = notes.filter(n => !ids.includes(n.id)) }, stale: vi.fn() })
    const editor = mount(sample(), guard)
    notes = [{ id: 'note', target: captureNodeTarget(editor.getJSON() as RichTextDocument, 'call'), quote: '提示块', comment: '核实', section: '', segments: [] }]
    const before = editor.getJSON()
    setCalloutTone(editor, 'call', 'warning')
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith(['note']))
    expect(editor.getJSON()).toEqual(before)
    guard.cancel(); expect(editor.getJSON()).toEqual(before)
    setCalloutTone(editor, 'call', 'warning')
    guard.confirm()
    expect(notes).toEqual([])
    expect(editor.state.doc.firstChild!.attrs.tone).toBe('warning')
    editor.commands.insertContent('后续输入')
    editor.commands.undo()
    expect(editor.state.doc.firstChild!.attrs.tone).toBe('warning')
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
  })
})
