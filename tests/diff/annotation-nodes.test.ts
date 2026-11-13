// @vitest-environment happy-dom
import { createHash } from 'node:crypto'
import { Editor, Node } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, describe, expect, it } from 'vitest'
import { annotationNodeCapabilities, annotationNodeManifest, createAnnotationNodeRegistry, captureNodeTarget, captureObjectTarget,
  extractAnnotationBlocks, anchorSegment, resolveAnnotation, resolveAnnotationRequest, objectTargetPresentation, formatAnnotationRequest,
  parseAnnotationRequest, annotationFingerprint, assertAnnotationCapabilities, ANNOTATION_REQUIREMENTS, LEGACY_OBJECT_REQUIREMENTS,
  type AiAnnotation, type AnnotationRequest } from '../../shared/agent/annotations'
import { stableJson } from '../../skills/requirement-board/scripts/annotation-objects.mjs'
import { objectTargetsAtElement, keyboardObjectElement } from '../../app/components/editor/annotation-object-menu'
import { agentDocumentSchema } from '../../shared/agent/schema'

const p = (id: string, text = '正文') => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
const callout = () => ({ type: 'doc', content: [{ type: 'callout', attrs: { diffId: 'notice', tone: 'note' }, content: [{ type: 'text', text: '上手路线：登录😀' }] }, p('p')] })
const note = (target: AiAnnotation['target']): AiAnnotation => ({ id: 'note', target, comment: '改为警告并补充说明', quote: '', section: '', segments: [] })
const request = (annotations: AiAnnotation[]): AnnotationRequest => ({ format: 'rb-annotations/v2', requirements: ANNOTATION_REQUIREMENTS,
  source: 'shared-draft', contentToken: `3:${'a'.repeat(64)}`, createdAt: '2026-11-07T10:00:00.000Z', overall: '', annotations,
  document: { id: 'req_nodes', key: 'REQ-1', title: '节点标注', origin: 'https://board.example', url: 'https://board.example/requirements/req_nodes' } })
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach(editor => { editor.view.dom.parentElement?.remove(); editor.destroy() }))

describe('通用节点标注能力', () => {
  it('提示块的文字范围和整体目标共存，内容、语气和格式变化使整体标注失效', () => {
    const doc = callout(), before = structuredClone(doc), selected = note(captureNodeTarget(doc, 'notice'))
    const block = extractAnnotationBlocks(doc)[0]!
    expect(block).toMatchObject({ blockType: 'callout', blockId: 'notice', text: '上手路线：登录😀' })
    const segment = anchorSegment(block, 0, 4)
    expect(resolveAnnotation({ ...note({ type: 'text' }), quote: segment.quote, segments: [segment] }, doc).status).toBe('exact')
    expect(selected.target).toMatchObject({ type: 'node', nodeType: 'callout', version: 1 })
    expect(objectTargetPresentation(selected.target as ReturnType<typeof captureNodeTarget>)).toMatchObject({ label: '提示块', menu: '标注提示块' })
    expect(resolveAnnotation(selected, doc).status).toBe('exact')
    expect(doc).toEqual(before)
    for (const change of [
      (value: any) => { value.content[0].attrs.tone = 'warning' },
      (value: any) => { value.content[0].content[0].text += '新内容' },
      (value: any) => { value.content[0].content[0].marks = [{ type: 'bold' }] },
      (value: any) => { value.content[0].type = 'paragraph' },
      (value: any) => { value.content[0].attrs.diffId = 'another' },
    ]) { const changed = structuredClone(doc); change(changed); expect(resolveAnnotation(selected, changed).status).toBe('unresolved') }
  })

  it('只注册普通新节点即可使用相同 DOM/键盘命中、解析、复制、核验和能力检查', () => {
    const registry = createAnnotationNodeRegistry({ ...annotationNodeCapabilities, futureCard: { label: '业务卡片', text: 'children', object: true } })
    const doc = { type: 'doc', content: [{ type: 'futureCard', attrs: { diffId: 'card', status: 'draft' }, content: [p('inner', '尚未出现过的节点')] }] }
    const element = document.createElement('div'); document.body.append(element)
    const editor = new Editor({ element, extensions: [Document, Text, Paragraph.extend({ addAttributes: () => ({ diffId: { default: null } }) }),
      Node.create({ name: 'futureCard', group: 'block', content: 'block+', addAttributes: () => ({ diffId: { default: null }, status: { default: 'draft' } }),
        renderHTML: ({ HTMLAttributes }) => ['article', HTMLAttributes, 0] })], content: doc })
    editors.push(editor)
    const clicked = editor.view.dom.querySelector('p')!
    const targets = objectTargetsAtElement(editor, clicked, registry)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ type: 'node', nodeType: 'futureCard', blockId: 'card' })
    expect(objectTargetPresentation(targets[0]!, false, registry).menu).toBe('标注业务卡片')
    editor.commands.setNodeSelection(0)
    expect(keyboardObjectElement(editor, null, registry)).toBe(editor.view.dom.querySelector('article'))
    editor.commands.setTextSelection(2)
    expect(keyboardObjectElement(editor, null, registry)).toBe(editor.view.dom.querySelector('article'))
    const selected = note(targets[0]!)
    const payload = request([selected]), encoded = formatAnnotationRequest(payload, registry)
    expect(parseAnnotationRequest(encoded, registry)).toEqual(payload)
    const snapshot = { id: 'req_nodes', schemaVersion: 3, contentToken: payload.contentToken, contentJson: doc }
    expect(resolveAnnotationRequest(payload, snapshot, payload.document.origin, registry)).toMatchObject({ ready: true, topLevelIds: ['card'] })
    const schema = { ...agentDocumentSchema(), annotationNodes: annotationNodeManifest(registry) }
    expect(() => assertAnnotationCapabilities(payload, schema, registry)).not.toThrow()
    expect(() => assertAnnotationCapabilities(payload, agentDocumentSchema(), registry)).toThrow('futureCard')
    const changed = structuredClone(doc); changed.content[0]!.attrs.status = 'published'
    expect(resolveAnnotation(selected, changed, registry).status).toBe('unresolved')
    expect(extractAnnotationBlocks(doc, registry)[0]!.topLevelId).toBe('card')
    expect(() => parseAnnotationRequest(encoded)).toThrow('更新')
  })

  it('图片/表格/单元格共用 node 目标，特殊上下文和展示规则由注册项提供', () => {
    const doc = { type: 'doc', content: [{ type: 'table', attrs: { diffId: 'table' }, content: [{ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { diffId: 'cell', rowspan: 1, colspan: 1 }, content: [p('cell-p'),
        { type: 'image', attrs: { diffId: 'image', src: '/uploads/one.png', width: 80 }, content: [{ type: 'imageCaption' }] }] },
    ] }] }] }
    const targets = ['image', 'cell', 'table'].map(id => captureNodeTarget(doc, id)), notes = targets.map((target, index) => ({ ...note(target), id: `note-${index}` }))
    expect(targets.every(target => target.type === 'node')).toBe(true)
    expect(objectTargetPresentation(targets[0]!).thumbnail).toBe('/uploads/one.png')
    expect(objectTargetPresentation(targets[1]!, true)).toMatchObject({ menu: '标注所在单元格', description: '第 1 行 · 第 1 列' })
    const changed = structuredClone(doc) as any
    changed.content[0].content[0].content[0].content[1].attrs.width = 200
    changed.content[0].content[0].content[0].attrs.colwidth = [200]
    expect(notes.map(value => resolveAnnotation(value, changed).status)).toEqual(['exact', 'exact', 'exact'])
    changed.content[0].attrs.diffId = 'another-table'
    expect(resolveAnnotation(notes[1]!, changed)).toMatchObject({ status: 'unresolved', reason: expect.stringContaining('所属表格') })
    expect(() => parseAnnotationRequest(formatAnnotationRequest(request([note({ ...targets[1]!, context: { tableId: 'table', range: 'invalid' } })])))).toThrow('上下文')
  })

  it('旧 v2 对象和新节点混用仍按原复制字段核对回执，不改写旧目标', async () => {
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { diffId: 'image', src: '/uploads/one.png' } }, ...callout().content] }
    const legacy = note(captureObjectTarget(doc, 'image', 'image'))
    const original = structuredClone(legacy), payload = { ...request([legacy]), requirements: LEGACY_OBJECT_REQUIREMENTS }
    const value = ['rb-annotations/v2', legacy.target, legacy.id, legacy.comment, legacy.quote, legacy.section, '', []]
    const fingerprint = createHash('sha256').update(stableJson(value)).digest('hex')
    expect(await annotationFingerprint(legacy, '')).toBe(fingerprint)
    expect(resolveAnnotation(legacy, doc).status).toBe('exact')
    expect(parseAnnotationRequest(formatAnnotationRequest(payload))).toEqual(payload)
    expect(legacy).toEqual(original)
    const mixed = request([legacy, { ...note(captureNodeTarget(doc, 'notice')), id: 'new' }])
    expect(parseAnnotationRequest(formatAnnotationRequest(mixed)).annotations[0]).toEqual(original)
    expect(await annotationFingerprint(mixed.annotations[0]!, '')).toBe(fingerprint)
    const schema = agentDocumentSchema()
    expect(() => assertAnnotationCapabilities(payload, { ...schema, capabilitiesVersion: 7 })).not.toThrow()
    expect(() => assertAnnotationCapabilities(mixed, { ...schema, capabilitiesVersion: 7 })).toThrow('capabilities 8')
    expect(() => formatAnnotationRequest({ ...mixed, requirements: LEGACY_OBJECT_REQUIREMENTS })).toThrow('不能降级')
    expect(() => formatAnnotationRequest(request([note({ ...captureNodeTarget(doc, 'notice'), version: 2 })]))).toThrow('能力')
  })
})
