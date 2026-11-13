import { Extension } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { EDITOR_ACTIVITY_CHANGE_EVENT, EDITOR_IMAGE_RESIZE_EVENT, EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'
import { cancelEditorGeometry, scheduleEditorGeometry } from './editor-geometry'
import { findImageUploadCaretAnchor, imageUploadPlaceholderPluginKey } from './image-upload-placeholder'

type CaretCoordinates = Pick<DOMRect, 'left' | 'top' | 'bottom'>
type CaretHostRect = Pick<DOMRect, 'left' | 'top'>

export interface SmoothCaretGeometry {
  x: number
  y: number
  height: number
}

const smoothCaretPluginKey = new PluginKey('smoothCaret')
const CARET_VERTICAL_INSET = 1
const CARET_BLINK_DELAY = 220
const EMPTY_CARET_ANCHOR_ATTRIBUTE = 'data-requirement-empty-caret-anchor'
const EMPTY_CARET_ANCHOR_KEY = 'requirement-empty-caret-anchor'

function roundToDevicePixel(value: number) {
  if (typeof window === 'undefined') return value
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
  return Math.round(value * pixelRatio) / pixelRatio
}

export function calculateSmoothCaretGeometry(
  coordinates: CaretCoordinates,
  hostRect: CaretHostRect,
  hostScrollLeft = 0,
  hostScrollTop = 0,
): SmoothCaretGeometry {
  const rawHeight = Math.max(2, coordinates.bottom - coordinates.top)
  const inset = Math.min(CARET_VERTICAL_INSET, Math.max(0, (rawHeight - 2) / 2))

  return {
    x: roundToDevicePixel(coordinates.left - hostRect.left + hostScrollLeft),
    y: roundToDevicePixel(coordinates.top - hostRect.top + hostScrollTop + inset),
    height: roundToDevicePixel(Math.max(2, rawHeight - inset * 2)),
  }
}

export function isEmptyTextblockSelection(selection: TextSelection) {
  const { $head } = selection
  return $head.parent.isTextblock && $head.parent.content.size === 0
}

function createEmptyCaretAnchor() {
  const anchor = document.createElement('span')
  anchor.className = 'requirement-editor__empty-caret-anchor'
  anchor.setAttribute(EMPTY_CARET_ANCHOR_ATTRIBUTE, '')
  anchor.setAttribute('aria-hidden', 'true')
  anchor.textContent = '\u200b'
  return anchor
}

function hasUploadAtCaret(state: EditorState) {
  return Boolean(imageUploadPlaceholderPluginKey.getState(state)?.find(state.selection.head, state.selection.head).length)
}

export function createEmptyCaretAnchorDecorations(state: EditorState) {
  const { selection } = state
  if (
    !(selection instanceof TextSelection)
    || !selection.empty
    || !isEmptyTextblockSelection(selection)
    || hasUploadAtCaret(state)
  ) return DecorationSet.empty

  return DecorationSet.create(state.doc, [
    Decoration.widget(selection.head, createEmptyCaretAnchor, {
      key: EMPTY_CARET_ANCHOR_KEY,
      side: -1,
      relaxedSide: true,
      ignoreSelection: true,
    }),
  ])
}

export function emptyCaretAnchorCoordinates(root: ParentNode): CaretCoordinates | null {
  return caretAnchorCoordinates(root.querySelector<HTMLElement>(`[${EMPTY_CARET_ANCHOR_ATTRIBUTE}]`))
}

function caretAnchorCoordinates(anchor: HTMLElement | null): CaretCoordinates | null {
  if (!anchor) return null

  const rect = anchor.getBoundingClientRect()
  if (rect.bottom <= rect.top) return null

  return {
    left: rect.left,
    top: rect.top,
    bottom: rect.bottom,
  }
}

export function compositionCaretCoordinates(root: HTMLElement): CaretCoordinates | null {
  const selection = root.ownerDocument.getSelection()
  if (
    !selection?.focusNode
    || !selection.anchorNode
    || !root.contains(selection.focusNode)
    || !root.contains(selection.anchorNode)
  ) return null

  // 组词时 DOM 选区可能先于 ProseMirror 状态更新，且可能覆盖候选文字。
  // 只测量焦点端，不修改真实选区或组词节点，以保留输入法候选框的位置。
  const range = root.ownerDocument.createRange()
  range.setStart(selection.focusNode, selection.focusOffset)
  range.collapse(true)
  const rect = range.getClientRects()[0]
  if (!rect || rect.bottom <= rect.top) return null

  return { left: rect.left, top: rect.top, bottom: rect.bottom }
}

function textCaretCoordinates(view: EditorView, selection: TextSelection): CaretCoordinates | null {
  // 正向 coordsAtPos 会读到块级上传 widget；只测量同位置的文字行锚点。
  const uploadAnchor = findImageUploadCaretAnchor(view, selection.head)
  if (uploadAnchor) return caretAnchorCoordinates(uploadAnchor)
  if (isEmptyTextblockSelection(selection)) return emptyCaretAnchorCoordinates(view.dom)
  return view.coordsAtPos(selection.head, 1)
}

export function createSmoothCaretPlugin(isActive: () => boolean = () => true) {
  return new Plugin({
    key: smoothCaretPluginKey,
    props: {
      decorations: createEmptyCaretAnchorDecorations,
    },
    view(view) {
      const parentElement = view.dom.parentElement
      if (!parentElement) return {}
      const host: HTMLElement = parentElement

      const caret = document.createElement('span')
      caret.className = 'requirement-editor__smooth-caret'
      caret.setAttribute('aria-hidden', 'true')
      host.classList.add('requirement-editor__caret-host')
      host.append(caret)

      const geometryOwner = {}
      let smoothFrame = 0
      let blinkTimer = 0
      let isComposing = false
      let isImageResizing = false
      let isPositioned = false
      let previousGeometry = ''

      function clearBlinkTimer() {
        if (!blinkTimer) return
        window.clearTimeout(blinkTimer)
        blinkTimer = 0
      }

      function hideCaret() {
        clearBlinkTimer()
        if (smoothFrame) window.cancelAnimationFrame(smoothFrame)
        smoothFrame = 0
        isPositioned = false
        previousGeometry = ''
        caret.classList.remove(
          'requirement-editor__smooth-caret--visible',
          'requirement-editor__smooth-caret--smooth',
          'requirement-editor__smooth-caret--blinking',
        )
        view.dom.classList.remove('requirement-editor__surface--smooth-caret')
      }

      function startBlinking() {
        clearBlinkTimer()
        caret.classList.remove('requirement-editor__smooth-caret--blinking')
        blinkTimer = window.setTimeout(() => {
          blinkTimer = 0
          if (!caret.classList.contains('requirement-editor__smooth-caret--visible')) return
          caret.classList.add('requirement-editor__smooth-caret--blinking')
        }, CARET_BLINK_DELAY)
      }

      function updateCaretPosition() {
        const { selection } = view.state
        const composing = isComposing || view.composing
        const canShow =
          isActive() && view.editable &&
          view.hasFocus() &&
          selection instanceof TextSelection &&
          (composing || selection.empty)

        if (!canShow) {
          return hideCaret
        }

        try {
          const coordinates = composing
            ? compositionCaretCoordinates(view.dom)
              ?? caretAnchorCoordinates(findImageUploadCaretAnchor(view, selection.head))
              ?? emptyCaretAnchorCoordinates(view.dom)
            : textCaretCoordinates(view, selection)
          if (!coordinates) {
            return hideCaret
          }
          const geometry = calculateSmoothCaretGeometry(
            coordinates,
            host.getBoundingClientRect(),
            host.scrollLeft,
            host.scrollTop,
          )
          const geometryKey = `${geometry.x}:${geometry.y}:${geometry.height}`
          const geometryChanged = geometryKey !== previousGeometry

          return () => {
            if (!isActive()) { hideCaret(); return }
            if (geometryChanged) {
              caret.style.setProperty('--requirement-caret-x', `${geometry.x}px`)
              caret.style.setProperty('--requirement-caret-y', `${geometry.y}px`)
              caret.style.height = `${geometry.height}px`
            }
            caret.classList.add('requirement-editor__smooth-caret--visible')
            view.dom.classList.add('requirement-editor__surface--smooth-caret')

            isPositioned = true
            if (!isImageResizing && !smoothFrame && !caret.classList.contains('requirement-editor__smooth-caret--smooth')) {
              smoothFrame = window.requestAnimationFrame(() => {
                smoothFrame = 0
                if (isPositioned && isActive() && !isImageResizing) {
                  caret.classList.add('requirement-editor__smooth-caret--smooth')
                }
              })
            }

            if (geometryChanged && !isImageResizing) startBlinking()
            previousGeometry = geometryKey
          }
        } catch {
          return hideCaret
        }
      }

      function scheduleCaretUpdate() {
        if (!isActive()) return
        scheduleEditorGeometry(view.dom, geometryOwner, updateCaretPosition)
      }

      function handleCompositionStart() {
        isComposing = true
        scheduleCaretUpdate()
      }

      function handleCompositionEnd() {
        isComposing = false
        scheduleCaretUpdate()
      }

      function handleCompositionUpdate() {
        if (isComposing || view.composing) scheduleCaretUpdate()
      }

      function handleBlur() {
        isComposing = false
        scheduleCaretUpdate()
      }

      function handleImageResize(event: Event) {
        isImageResizing = (event as CustomEvent<boolean>).detail
        if (smoothFrame) window.cancelAnimationFrame(smoothFrame)
        smoothFrame = 0
        // 连续布局变化已由指针驱动；不要每次再启动 105ms 追赶动画或闪烁计时。
        caret.classList.remove('requirement-editor__smooth-caret--smooth', 'requirement-editor__smooth-caret--blinking')
        clearBlinkTimer()
        if (!isImageResizing && isActive()) startBlinking()
        scheduleCaretUpdate()
      }

      view.dom.addEventListener('focus', scheduleCaretUpdate, true)
      view.dom.addEventListener('blur', handleBlur, true)
      view.dom.addEventListener('compositionstart', handleCompositionStart)
      view.dom.addEventListener('compositionupdate', handleCompositionUpdate)
      view.dom.addEventListener('compositionend', handleCompositionEnd)
      view.dom.addEventListener('input', handleCompositionUpdate)
      view.dom.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, scheduleCaretUpdate)
      view.dom.addEventListener(EDITOR_IMAGE_RESIZE_EVENT, handleImageResize)
      function suspend() {
        cancelEditorGeometry(view.dom, geometryOwner)
        view.dom.ownerDocument.removeEventListener('selectionchange', handleCompositionUpdate)
        window.removeEventListener('resize', scheduleCaretUpdate)
        window.removeEventListener('scroll', scheduleCaretUpdate, true)
        hideCaret()
      }
      function updateActivity() {
        suspend()
        if (!isActive()) return
        view.dom.ownerDocument.addEventListener('selectionchange', handleCompositionUpdate)
        window.addEventListener('resize', scheduleCaretUpdate)
        window.addEventListener('scroll', scheduleCaretUpdate, true)
        scheduleCaretUpdate()
      }
      view.dom.addEventListener(EDITOR_ACTIVITY_CHANGE_EVENT, updateActivity)
      updateActivity()

      return {
        update: scheduleCaretUpdate,
        destroy() {
          suspend()
          if (smoothFrame) window.cancelAnimationFrame(smoothFrame)
          clearBlinkTimer()
          view.dom.removeEventListener('focus', scheduleCaretUpdate, true)
          view.dom.removeEventListener('blur', handleBlur, true)
          view.dom.removeEventListener('compositionstart', handleCompositionStart)
          view.dom.removeEventListener('compositionupdate', handleCompositionUpdate)
          view.dom.removeEventListener('compositionend', handleCompositionEnd)
          view.dom.removeEventListener('input', handleCompositionUpdate)
          view.dom.ownerDocument.removeEventListener('selectionchange', handleCompositionUpdate)
          view.dom.removeEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, scheduleCaretUpdate)
          view.dom.removeEventListener(EDITOR_IMAGE_RESIZE_EVENT, handleImageResize)
          view.dom.removeEventListener(EDITOR_ACTIVITY_CHANGE_EVENT, updateActivity)
          window.removeEventListener('resize', scheduleCaretUpdate)
          window.removeEventListener('scroll', scheduleCaretUpdate, true)
          view.dom.classList.remove('requirement-editor__surface--smooth-caret')
          host.classList.remove('requirement-editor__caret-host')
          caret.remove()
        },
      }
    },
  })
}

export const SmoothCaret = Extension.create<{ isActive: () => boolean }>({
  name: 'smoothCaret',

  addOptions() { return { isActive: () => true } },

  addProseMirrorPlugins() {
    return [createSmoothCaretPlugin(this.options.isActive)]
  },
})
