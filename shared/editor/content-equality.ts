import type { RichTextDocument } from './document'

// 比较正文实际内容，忽略块身份与 JSON 键/mark 的排列，不忽略格式、链接或结构。
export function richTextContentKey(document: RichTextDocument) {
  const canonical = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) {
      const values = value.map(item => canonical(item))
      return key === 'marks' ? values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : values
    }
    if (value && typeof value === 'object') {
      if ('type' in value && value.type === 'taskItem') {
        const attrs = ('attrs' in value ? value.attrs : {}) as Record<string, unknown> | undefined
        value = { ...value, attrs: { ...attrs, checked: attrs?.checked === true } }
      }
      return Object.fromEntries(Object.entries(value as object)
      .filter(([name, item]) => name !== 'diffId' && item != null && !(Array.isArray(item) && !item.length))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => [name, canonical(item, name)])
      .filter(([name, item]) => name !== 'attrs' || Object.keys(item as object).length))
    }
    return value
  }
  return JSON.stringify(canonical(document))
}

export function sameRichTextContent(left: RichTextDocument, right: RichTextDocument) {
  return left === right || richTextContentKey(left) === richTextContentKey(right)
}

export function sameVersionContent(left: { title: string; contentJson: RichTextDocument }, right: { title: string; contentJson: RichTextDocument }) {
  return left.title === right.title && sameRichTextContent(left.contentJson, right.contentJson)
}
