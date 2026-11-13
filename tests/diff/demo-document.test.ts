import { describe, expect, it } from 'vitest'
import { createDemoDocuments, DEMO_IMAGE_SOURCES } from '../../shared/demo/document'
import { BLOCK_NODE_TYPES, type RichTextNode } from '../../shared/editor/document'
import { parseRichTextDocument } from '../../shared/editor/validation'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { revertDraftChange } from '../../shared/diff/revert-draft-change'

describe('游客静态示例', () => {
  it('所有历史版本通过真实 schema，块身份唯一，图片仅使用审定静态资源', () => {
    for (const { content } of createDemoDocuments().revisions) {
      expect(() => parseRichTextDocument(content)).not.toThrow()
      const ids: string[] = []
      function inspect(node: RichTextNode) {
        if (BLOCK_NODE_TYPES.some(type => type === node.type)) { expect(node.attrs?.diffId).toMatch(/^demo_/); ids.push(String(node.attrs?.diffId)) }
        if (node.type === 'image') expect(DEMO_IMAGE_SOURCES).toContain(node.attrs?.src)
        for (const mark of node.marks ?? []) if (mark.type === 'link') expect(mark.attrs?.href).toBe('https://github.com/moubing')
        node.content?.forEach(inspect)
      }
      content.content.forEach(inspect)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('当前导览实际展示全部块类型、三级标题和文字格式', () => {
    const nodes = new Set<string>(), marks = new Set<string>(), levels = new Set<number>(), tones = new Set<string>()
    function inspect(node: RichTextNode) {
      nodes.add(node.type)
      node.marks?.forEach(mark => marks.add(mark.type))
      if (node.type === 'heading') levels.add(Number(node.attrs?.level))
      if (node.type === 'callout') tones.add(String(node.attrs?.tone))
      node.content?.forEach(inspect)
    }
    inspect(createDemoDocuments().draft)
    for (const type of [...BLOCK_NODE_TYPES, 'hardBreak', 'imageCaption', 'detailsContent', 'tableRow']) expect(nodes.has(type), type).toBe(true)
    expect([...levels].sort()).toEqual([1, 2, 3])
    expect([...tones].sort()).toEqual(['danger', 'note', 'tip', 'warning'])
    expect([...marks].sort()).toEqual(['bold', 'code', 'highlight', 'italic', 'link', 'strike', 'underline'])
  })

  it('页面之间、临时副本与全部历史之间没有可变对象共享', () => {
    const first = createDemoDocuments(), second = createDemoDocuments()
    const original = JSON.stringify(second)
    first.draft.content[0]!.content![0]!.text = '临时修改'
    expect(JSON.stringify(second)).toBe(original)
    expect(first.revisions).toEqual(second.revisions)
    first.revisions[0]!.content.content[0]!.content![0]!.text = '测试历史副本'
    expect(first.revisions[1]).toEqual(second.revisions[1])
  })

  it('真实 Diff 能识别文字、格式、任务、表格、增删变化并在副本中局部恢复', () => {
    const { revisions, draft } = createDemoDocuments()
    const changes = buildRichTextDiff(revisions[0]!.content, revisions[2]!.content).pairs
    for (const id of ['demo_description', 'demo_rule', 'demo_fields_table', 'demo_task_edit', 'demo_code', 'demo_details']) {
      expect(changes.find(pair => pair.base?.id === id)?.status, id).toBe('modified')
    }
    expect(changes.some(pair => pair.status === 'inserted')).toBe(true)
    expect(changes.some(pair => pair.status === 'deleted')).toBe(true)
    const initial = JSON.stringify(revisions)
    const pair = changes.find(pair => pair.base?.id === 'demo_rule')!
    expect(revertDraftChange(draft, revisions[0]!.content, { status: 'modified', pairs: [pair] }).changed).toBe(true)
    expect(JSON.stringify(revisions)).toBe(initial)
  })
})
