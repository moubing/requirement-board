import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { anchorSegment, extractAnnotationBlocks, resolveAnnotation, validateAnnotation, objectTargetPresentation, type AiAnnotation, type AnnotationSegment, type ObjectAnnotationTarget } from '~~/shared/agent/annotations'

export function objectAnnotationElement(editor: Editor, target: ObjectAnnotationTarget): HTMLElement | null {
  let position: number | undefined
  editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === target.blockId) position = pos })
  if (position === undefined) return null
  const element = editor.view.nodeDOM(position)
  if (!(element instanceof HTMLElement)) return null
  const selector = objectTargetPresentation(target).dom.boundsSelector
  if (selector) return element.matches(selector) ? element : element.querySelector<HTMLElement>(selector) ?? element
  return element
}

export function captureAnnotation(editor: Editor): AiAnnotation {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection) || selection.empty) throw new Error('请先选中需要标注的文字。')
  const blocks = extractAnnotationBlocks(editor.getJSON())
  const segments: AnnotationSegment[] = []
  let unsupported = false
  doc.nodesBetween(selection.from, selection.to, (node, position) => {
    if (node.isTextblock) {
      const block = blocks.find(value => value.blockId === node.attrs.diffId)
      if (!block) { unsupported = true; return false }
      const start = Math.max(0, selection.from - position - 1)
      const end = Math.min(node.content.size, selection.to - position - 1)
      if (end > start) segments.push(anchorSegment(block,
        Array.from(block.text.slice(0, start)).length, Array.from(block.text.slice(0, end)).length))
      return false
    }
    if (node.isAtom) unsupported = true
  })
  if (unsupported) throw new Error('此选区包含图片或表格文字，请通过对象菜单标注图片、整张表格或单个单元格。')
  const note: AiAnnotation = { id: crypto.randomUUID(), comment: '', target: { type: 'text' },
    quote: segments.map(segment => segment.quote).join('\n'), segments,
    section: (blocks.find(block => block.blockId === segments[0]?.blockId)?.section ?? '').slice(0, 1000) }
  validateAnnotation(note)
  const resolved = resolveAnnotation(note, editor.getJSON())
  if (resolved.status === 'unresolved') throw new Error(resolved.reason)
  return note
}

export function annotationRanges(editor: Editor, segments: AnnotationSegment[]): Range[] {
  const ranges: Range[] = []
  const positions = new Map<string, number>()
  editor.state.doc.descendants((node, position) => { if (node.isTextblock) positions.set(node.attrs.diffId, position) })
  for (const segment of segments) {
    const position = positions.get(segment.blockId)
    if (position === undefined) continue
    const chars = Array.from(segment.blockText)
    const from = editor.view.domAtPos(position + 1 + chars.slice(0, segment.start).join('').length)
    const to = editor.view.domAtPos(position + 1 + chars.slice(0, segment.end).join('').length)
    const range = editor.view.dom.ownerDocument.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    ranges.push(range)
  }
  return ranges
}
