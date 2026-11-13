import { extractPlainText, type RichTextDocument, type RichTextNode } from '#shared/editor/document'

export function templatePreview(document: RichTextDocument) {
  const sections: { heading: string; hint: string }[] = []
  let summary = ''
  const visit = (node: RichTextNode) => {
    if (node.type === 'heading') {
      const text = extractPlainText({ type: 'doc', content: [node] }).trim()
      if (text) sections.push({ heading: text, hint: '' })
    } else if (node.type === 'paragraph') {
      const text = extractPlainText({ type: 'doc', content: [node] }).trim()
      if (!summary) summary = text
      const section = sections.at(-1)
      if (section && !section.hint) section.hint = text.slice(0, 140)
    }
    node.content?.forEach(visit)
  }
  document.content.forEach(visit)
  return { sections: sections.slice(0, 3), remaining: Math.max(0, sections.length - 3), total: sections.length, summary: summary.slice(0, 140) }
}
