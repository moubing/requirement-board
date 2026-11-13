interface SelectionMenuPointerControllerOptions {
  getSurface: () => HTMLElement | null | undefined
  onSelectionStart: () => void
  onSelectionEnd: () => void
  settleDelay?: number
  scheduleDelay?: (callback: () => void, delay: number) => number
  cancelDelay?: (handle: number) => void
  scheduleFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

const DEFAULT_SELECTION_SETTLE_DELAY = 240

function isSelectableTarget(surface: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Node) || !surface.contains(target)) return false
  const element = target instanceof Element ? target : target.parentElement
  return !element?.closest('[contenteditable="false"]')
}

export function createSelectionMenuPointerController(
  options: SelectionMenuPointerControllerOptions,
) {
  const settleDelay = options.settleDelay ?? DEFAULT_SELECTION_SETTLE_DELAY
  const scheduleDelay = options.scheduleDelay
    ?? ((callback, delay) => window.setTimeout(callback, delay))
  const cancelDelay = options.cancelDelay ?? (handle => window.clearTimeout(handle))
  const scheduleFrame = options.scheduleFrame ?? (callback => window.requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? (handle => window.cancelAnimationFrame(handle))
  let activePointerId: number | null = null
  let selectionEndDelay = 0
  let selectionEndFrame = 0
  let selectionEndPending = false

  function cancelScheduledEnd() {
    if (selectionEndDelay) {
      cancelDelay(selectionEndDelay)
      selectionEndDelay = 0
    }
    if (selectionEndFrame) {
      cancelFrame(selectionEndFrame)
      selectionEndFrame = 0
    }
  }

  function isSuppressed() {
    return activePointerId !== null || selectionEndPending
  }

  function handlePointerDown(event: PointerEvent) {
    const surface = options.getSurface()
    if (
      !surface
      || !event.isPrimary
      || event.button !== 0
      || !isSelectableTarget(surface, event.target)
    ) return

    const wasSuppressed = isSuppressed()
    activePointerId = event.pointerId
    cancelScheduledEnd()
    selectionEndPending = false
    if (!wasSuppressed) options.onSelectionStart()
  }

  function handlePointerEnd(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId) return

    activePointerId = null
    cancelScheduledEnd()
    selectionEndPending = true
    selectionEndDelay = scheduleDelay(() => {
      selectionEndDelay = 0
      selectionEndFrame = scheduleFrame(() => {
        selectionEndFrame = 0
        if (!selectionEndPending || activePointerId !== null) return
        selectionEndPending = false
        options.onSelectionEnd()
      })
    }, settleDelay)
  }

  function handlePointerCancel(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId) return
    cancel()
  }

  function cancel() {
    activePointerId = null
    cancelScheduledEnd()
    selectionEndPending = false
  }

  return {
    isSuppressed,
    handlePointerDown,
    handlePointerEnd,
    handlePointerCancel,
    cancel,
    destroy: cancel,
  }
}
