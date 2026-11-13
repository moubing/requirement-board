import { describe, expect, it } from 'vitest'
import { sameRichTextContent, sameVersionContent } from '../../shared/editor/content-equality'
import type { RichTextDocument } from '../../shared/editor/document'

const snapshot = () => ({ title: '原名称', contentJson: { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [{ type: 'text', text: '相同正文' }] }] } as RichTextDocument })

describe('草稿与正式版本的内容比较', () => {
  it('忽略身份和键序，格式、链接目标和嵌套结构的变化仍计入正文', () => {
    const one = snapshot().contentJson, two = snapshot().contentJson
    two.content[0]!.attrs = { diffId: 'new-id' }
    expect(sameRichTextContent(one, two)).toBe(true)
    two.content[0]!.content![0]!.marks = [{ type: 'bold' }]
    expect(sameRichTextContent(one, two)).toBe(false)
    one.content[0]!.content![0]!.marks = [{ type: 'bold' }, { type: 'link', attrs: { href: '/one', target: '_blank' } }]
    two.content[0]!.content![0]!.marks = [{ type: 'link', attrs: { target: '_blank', href: '/one' } }, { type: 'bold' }]
    expect(sameRichTextContent(one, two)).toBe(true)
    two.content[0]!.content![0]!.marks![0]!.attrs!.href = '/two'
    expect(sameRichTextContent(one, two)).toBe(false)
    expect(sameRichTextContent(one, { type: 'doc', content: [{ type: 'blockquote', content: one.content }] })).toBe(false)
  })

  it('比较标题及正文，改回原内容即恢复一致，属性和版本说明不影响结果', () => {
    const formal = snapshot(), draft = { ...snapshot(), priority: 'high', changeNote: '新说明' }
    expect(sameVersionContent(formal, draft)).toBe(true)
    draft.title = '新名称'
    expect(sameVersionContent(formal, draft)).toBe(false)
    draft.title = formal.title
    draft.contentJson.content[0]!.content![0]!.text = '修改正文'
    expect(sameVersionContent(formal, draft)).toBe(false)
    draft.contentJson = structuredClone(formal.contentJson)
    expect(sameVersionContent(formal, draft)).toBe(true)
  })
})
