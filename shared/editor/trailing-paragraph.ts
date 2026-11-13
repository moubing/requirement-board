import { createDiffId, type RichTextDocument } from './document'

// 与 StarterKit TrailingNode 的默认规则一致：已有普通段落（包括有文字的段落）就不追加。
export function needsTrailingParagraph(document: RichTextDocument) {
  const last = document.content.at(-1)
  return Boolean(last && last.type !== 'paragraph')
}

// 写入路径在校验后调用；返回新根对象，不改写输入或已有节点。
export function normalizeTrailingParagraph(document: RichTextDocument): RichTextDocument {
  if (!needsTrailingParagraph(document)) return document
  return { ...document, content: [...document.content, { type: 'paragraph', attrs: { diffId: createDiffId('para') } }] }
}
