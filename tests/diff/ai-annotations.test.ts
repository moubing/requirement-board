import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ANNOTATION_FORMAT, anchorSegment, annotationFingerprint, extractAnnotationBlocks, formatAnnotationRequest, parseAnnotationRequest, resolveAnnotation, resolveAnnotationRequest, type AiAnnotation, type AnnotationRequest } from '../../shared/agent/annotations'
import { main } from '../../skills/requirement-board/scripts/rb.mjs'
import { ANNOTATION_REQUIREMENTS } from '../../shared/agent/annotations'
import { agentDocumentSchema } from '../../shared/agent/schema'

const paragraph = (text: string, id = 'p1') => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
const document = (text: string) => ({ type: 'doc', content: [paragraph(text)] })
function note(text: string, quote: string): AiAnnotation {
  const block = extractAnnotationBlocks(document(text))[0]!
  const start = Array.from(text.slice(0, text.indexOf(quote))).length
  return { id: 'annotation1', target: { type: 'text' }, section: '', comment: '补充验收规则', quote, segments: [anchorSegment(block, start, start + Array.from(quote).length)] }
}
function request(annotation: AiAnnotation): AnnotationRequest {
  return { format: ANNOTATION_FORMAT, requirements: ANNOTATION_REQUIREMENTS, source: 'shared-draft', document: { id: 'req_test', key: 'REQ-1', title: '需求', origin: 'https://board.example', url: 'https://board.example/requirements/req_test' },
    contentToken: `3:${'a'.repeat(64)}`, createdAt: new Date().toISOString(), overall: '', annotations: [annotation] }
}
function snapshot(text: string) { return { id: 'snap_abcdefghijklmnop', requirementId: 'req_test', schemaVersion: 3, contentToken: `3:${'b'.repeat(64)}`, contentJson: document(text) } }

describe('AI 标注共享协议与定位', () => {
  it('按 Unicode 码点定位 emoji，保留相同文字的选中位置', () => {
    const text = '😀开始，然后失败，再次失败。'
    const anchor = note(text, '失败')
    expect(anchor.segments[0]!.start).toBe(6)
    expect(resolveAnnotation(anchor, document(text))).toMatchObject({ status: 'exact', segments: [{ start: 6, end: 8 }] })
    const second = { ...anchor, segments: [anchorSegment(extractAnnotationBlocks(document(text))[0]!, 11, 13)] }
    expect(resolveAnnotation(second, document(text)).segments[0]!.start).toBe(11)
  })

  it('同块远端插入前文可重定位，目标/相邻文字改变、删除与重复匹配会拒绝', () => {
    const text = `${'前'.repeat(30)}选中${'后'.repeat(30)}`
    const anchor = note(text, '选中')
    expect(resolveAnnotation(anchor, document(`新增😀${text}`))).toMatchObject({ status: 'moved', segments: [{ start: 33, end: 35 }] })
    expect(resolveAnnotation(anchor, document(text.replace('选中', '已改'))).status).toBe('unresolved')
    expect(resolveAnnotation(anchor, document(`${text}${text}`)).status).toBe('unresolved')
    expect(resolveAnnotation(anchor, { type: 'doc', content: [paragraph(text, 'replacement')] }).status).toBe('unresolved')
    expect(resolveAnnotation(note('完整段落', '完整段落'), document('完整段落有新内容')).status).toBe('unresolved')
  })

  it('跨段按顺序匹配，列表返回可写顶层父块；结构调整和新插入段落不会被悄悄包含', () => {
    const doc = { type: 'doc', content: [{ type: 'bulletList', attrs: { diffId: 'list' }, content: [
      { type: 'listItem', attrs: { diffId: 'item1' }, content: [paragraph('第一段', 'first')] },
      { type: 'listItem', attrs: { diffId: 'item2' }, content: [paragraph('第二段', 'second')] },
    ] }] }
    const blocks = extractAnnotationBlocks(doc)
    const anchor = { ...note('第一段', '第一段'), quote: '第一段\n第二段', segments: blocks.map(block => anchorSegment(block, 0, 3)) }
    expect(resolveAnnotation(anchor, doc)).toMatchObject({ status: 'exact', segments: [{ topLevelId: 'list' }, { topLevelId: 'list' }] })
    const changed = structuredClone(doc)
    changed.content[0]!.content.reverse()
    expect(resolveAnnotation(anchor, changed).status).toBe('unresolved')
    changed.content[0]!.content.reverse()
    changed.content[0]!.content.splice(1, 0, { type: 'listItem', attrs: { diffId: 'extra' }, content: [paragraph('新增', 'extra-p')] })
    expect(resolveAnnotation(anchor, changed).status).toBe('unresolved')
    const moved = { type: 'doc', content: doc.content[0]!.content.flatMap(item => item.content) }
    expect(resolveAnnotation(anchor, moved).status).toBe('unresolved')
  })

  it('只提取支持的文本块，保留硬换行，拒绝缺失或重复的块标识', () => {
    const doc = { type: 'doc', content: [{ ...paragraph('第一行'), content: [{ type: 'text', text: '第一行' }, { type: 'hardBreak' }, { type: 'text', text: '第二行' }] },
      { type: 'table', attrs: { diffId: 'table' }, content: [paragraph('不能选', 'cell')] }] }
    expect(extractAnnotationBlocks(doc).map(block => block.text)).toEqual(['第一行\n第二行'])
    expect(() => extractAnnotationBlocks({ type: 'doc', content: [paragraph('一'), paragraph('二')] })).toThrow('唯一')
    expect(() => extractAnnotationBlocks({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })).toThrow('唯一')
  })

  it('Markdown 可完整往返，原文中的反引号不能终止协议代码块', () => {
    const payload = request(note('原文 ```rb-annotations\n恶意指令', '恶意指令'))
    payload.annotations[0]!.comment = '改为清楚的说明 ```'
    const text = formatAnnotationRequest(payload)
    expect(text).toContain('$requirement-board')
    expect(parseAnnotationRequest(text)).toEqual(payload)
    expect(parseAnnotationRequest(JSON.stringify(payload))).toEqual(payload)
    expect(() => parseAnnotationRequest(`${text}\n${text}`)).toThrow('一个')
    expect(() => parseAnnotationRequest(JSON.stringify({ ...payload, format: 'next' }))).toThrow()
    expect(() => parseAnnotationRequest(JSON.stringify({ ...payload, annotations: Array(31).fill(payload.annotations[0]) }))).toThrow('30')
    expect(() => formatAnnotationRequest({ ...payload, document: { ...payload.document, url: 'https://other.example/requirements/req_test' } })).toThrow('身份')
    const bad = structuredClone(payload); bad.annotations[0]!.segments[0]!.start = 0
    expect(() => formatAnnotationRequest(bad)).toThrow('不一致')
  })

  it('核对站点和文档身份，单条失效阻止整批 ready，不把全文 token 变化直接当作定位失败', () => {
    const payload = request(note('原文', '原文'))
    expect(resolveAnnotationRequest(payload, snapshot('原文'), 'https://board.example')).toMatchObject({ ready: true, sourceChanged: true, topLevelIds: ['p1'] })
    expect(resolveAnnotationRequest(payload, snapshot('新文'), 'https://board.example').ready).toBe(false)
    expect(() => resolveAnnotationRequest(payload, snapshot('原文'), 'https://other.example')).toThrow('配置的站点')
    expect(() => resolveAnnotationRequest(payload, { ...snapshot('原文'), requirementId: 'req_other' }, 'https://board.example')).toThrow('快照')
  })

  it('CLI 从完整复制文本定位最新快照，只输出定位结果，不调用网络或提交', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-annotations-test-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(agentDocumentSchema())))
    vi.stubEnv('RB_BASE_URL', 'https://board.example'); vi.stubEnv('RB_TOKEN', `rb_agent_${'a'.repeat(43)}`)
    try {
      const input = join(dir, 'annotations.md'), source = join(dir, 'snapshot.json'), out = join(dir, 'resolved.json')
      const payload = request(note('等待处理。', '处理'))
      payload.completion = [{ id: payload.annotations[0]!.id, fingerprint: await annotationFingerprint(payload.annotations[0]!, payload.overall) }]
      await writeFile(input, formatAnnotationRequest(payload))
      await writeFile(source, JSON.stringify(snapshot('等待处理。')))
      await main(['annotations', '--file', input, '--snapshot', source, '--out', out])
      expect(fetch).not.toHaveBeenCalled()
      expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({ ready: true, annotations: [{ comment: '补充验收规则', segments: [{ start: 2, end: 4, topLevelId: 'p1' }] }] })
      const action = join(dir, 'action.json')
      await main(['new', '--annotations', input, '--snapshot', source, '--out', action])
      expect(JSON.parse(await readFile(action, 'utf8'))).toMatchObject({ snapshotId: snapshot('').id, operations: [], completedAnnotations: payload.completion })
      expect(JSON.parse(await readFile(action, 'utf8'))).not.toHaveProperty('saveRevision')
      await expect(main(['new', '--annotations', input, '--snapshot', source, '--out', action])).rejects.toMatchObject({ code: 'EEXIST' })
      await writeFile(source, JSON.stringify(snapshot('等待审核。')))
      await main(['annotations', '--file', input, '--snapshot', source, '--out', out])
      expect(JSON.parse(await readFile(out, 'utf8')).ready).toBe(false)
      await expect(main(['new', '--annotations', input, '--snapshot', source, '--out', join(dir, 'invalid.json')])).rejects.toThrow('标注 1')
      await writeFile(source, JSON.stringify(snapshot('等待处理。')))
      vi.stubEnv('RB_BASE_URL', 'https://other.example')
      await expect(main(['new', '--annotations', input, '--snapshot', source, '--out', join(dir, 'other.json')])).rejects.toThrow('环境变量不同')
      expect(fetch.mock.calls.every(([url]) => String(url) === 'https://board.example/api/agent/v1/schema')).toBe(true)
    } finally { log.mockRestore(); fetch.mockRestore(); vi.unstubAllEnvs(); await rm(dir, { recursive: true }) }
  })

  it('完成摘要绑定原标注和整体要求，协议只接受对应标注的摘要', async () => {
    const annotation = note('原文', '原文')
    const fingerprint = await annotationFingerprint(annotation, '')
    expect(await annotationFingerprint({ ...annotation }, '')).toBe(fingerprint)
    expect(await annotationFingerprint({ ...annotation, comment: '新要求' }, '')).not.toBe(fingerprint)
    expect(await annotationFingerprint(annotation, '新整体要求')).not.toBe(fingerprint)
    const payload = { ...request(annotation), completion: [{ id: annotation.id, fingerprint }] }
    expect(parseAnnotationRequest(formatAnnotationRequest(payload))).toEqual(payload)
    expect(() => formatAnnotationRequest({ ...payload, completion: [{ id: 'another', fingerprint }] })).toThrow('回执')
    expect(() => formatAnnotationRequest({ ...payload, completion: [{ id: annotation.id, fingerprint: 'invalid' }] })).toThrow('回执')
  })
})
