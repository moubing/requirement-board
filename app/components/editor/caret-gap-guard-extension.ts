import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

interface CaretGapPoint {
  x: number
  y: number
}

export interface CaretGapBoundary {
  start: number
  end: number
  left: number
  right: number
  top: number
  bottom: number
}

const TEXTBLOCK_SELECTOR = '[data-diff-id]'
const MAX_CARET_GAP = 48
const MAX_HORIZONTAL_DISTANCE = 48

function horizontalDistance(boundary: CaretGapBoundary, x: number) {
  if (x < boundary.left) return boundary.left - x
  if (x > boundary.right) return x - boundary.right
  return 0
}

export function isCaretGapPoint(
  boundaries: CaretGapBoundary[],
  point: CaretGapPoint,
  maxGap = MAX_CARET_GAP,
) {
  let previous: { boundary: CaretGapBoundary, distance: number, horizontal: number } | null = null
  let next: { boundary: CaretGapBoundary, distance: number, horizontal: number } | null = null

  for (const boundary of boundaries) {
    const horizontal = horizontalDistance(boundary, point.x)
    if (horizontal > MAX_HORIZONTAL_DISTANCE) continue
    if (point.y >= boundary.top && point.y <= boundary.bottom) return false

    if (boundary.bottom < point.y) {
      const distance = point.y - boundary.bottom
      if (
        distance <= maxGap
        && (!previous || distance < previous.distance || (
          distance === previous.distance && horizontal < previous.horizontal
        ))
      ) {
        previous = { boundary, distance, horizontal }
      }
    }

    if (boundary.top > point.y) {
      const distance = boundary.top - point.y
      if (
        distance <= maxGap
        && (!next || distance < next.distance || (
          distance === next.distance && horizontal < next.horizontal
        ))
      ) {
        next = { boundary, distance, horizontal }
      }
    }
  }

  if (!previous || !next) return false
  const gap = next.boundary.top - previous.boundary.bottom
  return (
    gap > 0
    && gap <= maxGap
    && previous.boundary.end <= next.boundary.start
  )
}

function textblockBoundary(
  view: EditorView,
  element: HTMLElement,
  rect = element.getBoundingClientRect(),
): CaretGapBoundary | null {
  if (rect.bottom <= rect.top || rect.right <= rect.left) return null

  try {
    const position = view.posAtDOM(element, 0)
    const resolved = view.state.doc.resolve(position)
    if (!resolved.parent.isTextblock) return null

    return {
      start: resolved.start(),
      end: resolved.end(),
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    }
  } catch {
    return null
  }
}

function eventTargetElement(target: EventTarget | null) {
  if (!(target instanceof Node)) return null
  return target instanceof HTMLElement ? target : target.parentElement
}

function collectNearbyTextblockBoundaries(view: EditorView, point: CaretGapPoint) {
  const boundaries: CaretGapBoundary[] = []
  const elements = view.dom.querySelectorAll<HTMLElement>(TEXTBLOCK_SELECTOR)

  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom < point.y - MAX_CARET_GAP || rect.top > point.y + MAX_CARET_GAP) continue
    const boundary = textblockBoundary(view, element, rect)
    if (boundary) boundaries.push(boundary)
  }

  return boundaries
}

export function handleCaretGapClick(view: EditorView, event: MouseEvent) {
  if (
    !view.editable
    || event.defaultPrevented
    || event.button !== 0
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) return false

  const target = eventTargetElement(event.target)
  if (!target || !view.dom.contains(target)) return false
  if (target.closest('[contenteditable="false"], .tableWrapper, table, [data-requirement-image]')) {
    return false
  }

  const point = { x: event.clientX, y: event.clientY }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false

  const targetBlock = target.closest<HTMLElement>(TEXTBLOCK_SELECTOR)
  if (targetBlock) {
    const boundary = textblockBoundary(view, targetBlock)
    if (boundary && point.y >= boundary.top && point.y <= boundary.bottom) return false
  }

  return isCaretGapPoint(collectNearbyTextblockBoundaries(view, point), point)
}

export function createCaretGapGuardPlugin() {
  return new Plugin({
    props: {
      handleClick(view, _position, event) {
        return handleCaretGapClick(view, event)
      },
      handleDoubleClick(view, _position, event) {
        return handleCaretGapClick(view, event)
      },
      handleTripleClick(view, _position, event) {
        return handleCaretGapClick(view, event)
      },
    },
  })
}

export const CaretGapGuard = Extension.create({
  name: 'caretGapGuard',

  addProseMirrorPlugins() {
    return [createCaretGapGuardPlugin()]
  },
})
