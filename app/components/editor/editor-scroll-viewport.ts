interface EditorScrollViewportGeometry {
  viewportHeight: number
  containerDocumentTop: number
  bottomGap?: number
  minimumHeight?: number
}

export const EDITOR_SCROLL_BOTTOM_GAP = 12
export const EDITOR_SCROLL_MIN_HEIGHT = 280

export function resolveEditorScrollViewportHeight({
  viewportHeight,
  containerDocumentTop,
  bottomGap = EDITOR_SCROLL_BOTTOM_GAP,
  minimumHeight = EDITOR_SCROLL_MIN_HEIGHT,
}: EditorScrollViewportGeometry) {
  const values = [viewportHeight, containerDocumentTop, bottomGap, minimumHeight]
  if (values.some(value => !Number.isFinite(value)) || viewportHeight <= 0) return null

  const availableHeight = Math.floor(
    viewportHeight - Math.max(0, containerDocumentTop) - Math.max(0, bottomGap),
  )
  return Math.max(Math.max(0, Math.floor(minimumHeight)), availableHeight)
}
