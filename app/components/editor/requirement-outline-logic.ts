import {
  extractPlainText,
  type RichTextDocument,
  type RichTextNode,
} from '../../../shared/editor/document'

export type RequirementOutlineLevel = 1 | 2 | 3

export interface RequirementOutlineItem {
  id: string
  label: string
  level: RequirementOutlineLevel
}

export interface OutlineHeadingGeometry {
  id: string
  top: number
  bottom: number
}

interface ActiveOutlineOptions {
  edgeInset?: number
  checkpointInset?: number
}

interface OutlineScrollGeometry {
  targetTop: number
  viewportTop: number
  currentScrollTop: number
  maxScrollTop: number
  topInset?: number
}

interface OutlineTrackItemGeometry {
  id: string
  top: number
  bottom: number
}

interface OutlineTrackGeometry {
  railTop: number
  railHeight: number
  items: OutlineTrackItemGeometry[]
  activeIds: readonly string[]
  pixelRatio?: number
}

export interface ResolvedOutlineTrackGeometry {
  y: number
  scaleY: number
}

const OUTLINE_LEVELS = new Set<RequirementOutlineLevel>([1, 2, 3])

function normalizeHeadingLabel(node: RichTextNode) {
  return extractPlainText(node).replace(/\s+/g, ' ').trim() || '未命名标题'
}

export function collectRequirementOutline(document: RichTextDocument) {
  const items: RequirementOutlineItem[] = []

  function visit(node: RichTextNode) {
    const level = Number(node.attrs?.level) as RequirementOutlineLevel
    const diffId = typeof node.attrs?.diffId === 'string' ? node.attrs.diffId.trim() : ''

    if (node.type === 'heading' && OUTLINE_LEVELS.has(level) && diffId) {
      items.push({
        id: diffId,
        label: normalizeHeadingLabel(node),
        level,
      })
    }

    node.content?.forEach(visit)
  }

  document.content.forEach(visit)
  return items
}

export function resolveActiveOutlineIds(
  headings: readonly OutlineHeadingGeometry[],
  viewportTop: number,
  viewportBottom: number,
  options: ActiveOutlineOptions = {},
) {
  if (![viewportTop, viewportBottom].every(Number.isFinite) || viewportBottom <= viewportTop) return []

  const edgeInset = Math.max(0, options.edgeInset ?? 4)
  const visibleTop = viewportTop + Math.min(edgeInset, (viewportBottom - viewportTop) / 2)
  const visibleBottom = viewportBottom - Math.min(edgeInset, (viewportBottom - viewportTop) / 2)
  const checkpoint = viewportTop + Math.max(0, options.checkpointInset ?? 28)
  const visibleIds: string[] = []
  let currentId = ''

  headings.forEach((heading) => {
    if (!heading.id || !Number.isFinite(heading.top) || !Number.isFinite(heading.bottom)) return
    if (heading.top <= checkpoint) currentId = heading.id
    if (heading.bottom > visibleTop && heading.top < visibleBottom) visibleIds.push(heading.id)
  })

  return visibleIds.length ? visibleIds : currentId ? [currentId] : []
}

export function resolveOutlineScrollTarget({
  targetTop,
  viewportTop,
  currentScrollTop,
  maxScrollTop,
  topInset = 28,
}: OutlineScrollGeometry) {
  const values = [targetTop, viewportTop, currentScrollTop, maxScrollTop, topInset]
  if (values.some(value => !Number.isFinite(value))) return null

  const desiredTop = currentScrollTop + targetTop - viewportTop - Math.max(0, topInset)
  return Math.round(Math.min(Math.max(0, maxScrollTop), Math.max(0, desiredTop)))
}

export function resolveOutlineTrackGeometry({
  railTop,
  railHeight,
  items,
  activeIds,
  pixelRatio = 1,
}: OutlineTrackGeometry): ResolvedOutlineTrackGeometry | null {
  if (!Number.isFinite(railTop) || !Number.isFinite(railHeight) || railHeight <= 0) return null

  const activeSet = new Set(activeIds)
  const firstIndex = items.findIndex(item => activeSet.has(item.id))
  if (firstIndex < 0) return null

  let lastIndex = firstIndex
  for (let index = firstIndex + 1; index < items.length; index += 1) {
    if (activeSet.has(items[index]!.id)) lastIndex = index
  }

  const first = items[firstIndex]!
  const last = items[lastIndex]!
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  const snap = (value: number) => Math.round(value * ratio) / ratio
  const rawTop = firstIndex === 0 ? 0 : first.top - railTop
  const rawBottom = lastIndex === items.length - 1 ? railHeight : last.bottom - railTop
  const top = snap(Math.min(railHeight, Math.max(0, rawTop)))
  const bottom = snap(Math.min(railHeight, Math.max(top, rawBottom)))
  const height = Math.max(1 / ratio, bottom - top)

  return {
    y: top,
    scaleY: Math.min(1, height / railHeight),
  }
}
