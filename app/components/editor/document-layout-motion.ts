import type { Editor, EditorEvents } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { gsap } from 'gsap'

import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'

export const DOCUMENT_LAYOUT_MOTION_META = 'requirementDocumentLayoutMotion'

export interface StructuralLayoutChange {
  firstChangedIndex: number
  previousChangedEnd: number
  nextChangedEnd: number
}

interface LayoutBlockElement {
  id: string
  index: number
  element: HTMLElement
}

interface PendingLayoutMotion {
  root: HTMLElement
  capturedIds: Set<string>
  previousRects: Map<string, DOMRect>
}

interface MovingLayoutTarget extends LayoutBlockElement {
  deltaX: number
  deltaY: number
}

interface ActiveLayoutMotion {
  root: HTMLElement
  scope: HTMLElement
  previousScopeId: string | null
  styleElement: HTMLStyleElement
  tween: gsap.core.Tween
}

export interface DocumentLayoutMotionOptions {
  getViewport?: () => HTMLElement | null | undefined
  isEnabled?: () => boolean
  maxTargets?: number
  overscan?: number
  duration?: number
  scheduleFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

const DEFAULT_MAX_TARGETS = 40
const DEFAULT_OVERSCAN = 40
const DEFAULT_DURATION = 0.24
const MIN_POSITION_DELTA = 0.75
const SCOPE_ATTRIBUTE = 'data-document-layout-motion-scope'

let controllerSequence = 0

function blockId(node: ProseMirrorNode) {
  const id = node.attrs.diffId
  return typeof id === 'string' && id ? id : ''
}

function layoutAttributeSignature(node: ProseMirrorNode) {
  if (node.type.name === 'heading') return `:${String(node.attrs.level ?? '')}`
  return ''
}

function structuralNodeSignature(node: ProseMirrorNode): string {
  const ownSignature = `${node.type.name}:${blockId(node)}${layoutAttributeSignature(node)}`
  if (node.isTextblock || !node.childCount) return ownSignature

  const childSignatures: string[] = []
  node.forEach((child) => {
    if (!child.isInline) childSignatures.push(structuralNodeSignature(child))
  })
  return childSignatures.length ? `${ownSignature}[${childSignatures.join('|')}]` : ownSignature
}

function topLevelStructuralSignatures(document: ProseMirrorNode) {
  const signatures: string[] = []
  document.forEach(node => signatures.push(structuralNodeSignature(node)))
  return signatures
}

export function describeStructuralLayoutChange(
  previousDocument: ProseMirrorNode,
  nextDocument: ProseMirrorNode,
): StructuralLayoutChange | null {
  const previous = topLevelStructuralSignatures(previousDocument)
  const next = topLevelStructuralSignatures(nextDocument)
  const sharedLength = Math.min(previous.length, next.length)
  let prefixLength = 0

  while (prefixLength < sharedLength && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1
  }

  if (prefixLength === previous.length && prefixLength === next.length) return null

  let suffixLength = 0
  while (
    suffixLength < previous.length - prefixLength
    && suffixLength < next.length - prefixLength
    && previous[previous.length - suffixLength - 1] === next[next.length - suffixLength - 1]
  ) {
    suffixLength += 1
  }

  return {
    firstChangedIndex: prefixLength,
    previousChangedEnd: previous.length - suffixLength,
    nextChangedEnd: next.length - suffixLength,
  }
}

function sliceContainsStructuralNode(step: ReplaceStep) {
  let containsStructuralNode = false
  step.slice.content.descendants((node) => {
    if (node.isInline) return
    containsStructuralNode = true
    return false
  })
  return containsStructuralNode
}

function inlineReplacementOnly(step: ReplaceStep, document: ProseMirrorNode) {
  if (sliceContainsStructuralNode(step)) return false

  try {
    const from = document.resolve(step.from)
    const to = document.resolve(step.to)
    return from.sameParent(to) && from.parent.isTextblock
  } catch {
    return false
  }
}

export function transactionMayChangeBlockStructure(transaction: Transaction) {
  if (!transaction.docChanged) return false

  return transaction.steps.some((step, index) => {
    if (!(step instanceof ReplaceStep)) return true
    return !inlineReplacementOnly(step, transaction.docs[index] ?? transaction.before)
  })
}

function collectTopLevelBlockElements(editor: Editor, document: ProseMirrorNode) {
  const blocks: LayoutBlockElement[] = []
  const ids = new Set<string>()
  const duplicates = new Set<string>()

  document.forEach((node, position, index) => {
    const id = blockId(node)
    if (ids.has(id)) duplicates.add(id)
    ids.add(id)
    const dom = editor.view.nodeDOM(position)
    if (!id || !dom || dom.nodeType !== Node.ELEMENT_NODE) return

    blocks.push({ id, index, element: dom as HTMLElement })
  })

  // 恢复中的异常协作状态可能包含重复 ID；跳过歧义目标，避免把首屏块匹配到文末副本。
  return blocks.filter(block => !duplicates.has(block.id))
}

function viewportBounds(viewport?: HTMLElement | null) {
  if (viewport) {
    const rect = viewport.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height || viewport.clientHeight,
    }
  }

  const height = document.documentElement.clientHeight || window.innerHeight
  return { top: 0, bottom: height, height }
}

function changedRegionHeight(
  blocks: LayoutBlockElement[],
  change: StructuralLayoutChange,
  viewportHeight: number,
) {
  const changedBlocks = blocks.filter(
    block => block.index >= change.firstChangedIndex && block.index < change.previousChangedEnd,
  )
  if (!changedBlocks.length) return 0

  const firstRect = changedBlocks[0]!.element.getBoundingClientRect()
  const lastRect = changedBlocks[changedBlocks.length - 1]!.element.getBoundingClientRect()
  const height = Math.max(0, lastRect.bottom - firstRect.top)
  return Math.min(height, Math.max(viewportHeight * 2, 1200))
}

function collectCaptureTargets(
  blocks: LayoutBlockElement[],
  change: StructuralLayoutChange,
  viewport: HTMLElement | null | undefined,
  options: DocumentLayoutMotionOptions,
) {
  const bounds = viewportBounds(viewport)
  const overscan = Math.max(0, options.overscan ?? DEFAULT_OVERSCAN)
  const maxTargets = Math.max(1, options.maxTargets ?? DEFAULT_MAX_TARGETS)
  const revealDistance = changedRegionHeight(blocks, change, bounds.height)
  const revealTop = bounds.top - overscan
  const visibleBottom = bounds.bottom + overscan
  const revealBottom = bounds.bottom + revealDistance + overscan
  const visibleTargets: LayoutBlockElement[] = []
  const revealedTargets: LayoutBlockElement[] = []

  for (const block of blocks) {
    const rect = block.element.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.bottom < revealTop) continue
    if (rect.top <= visibleBottom) {
      visibleTargets.push(block)
      continue
    }

    if (block.index < change.firstChangedIndex) continue
    if (rect.top > revealBottom) break

    revealedTargets.push(block)
  }

  return [...visibleTargets, ...revealedTargets].slice(0, maxTargets)
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function escapeAttributeValue(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function targetSelector(controllerId: string, target: MovingLayoutTarget) {
  const scope = `[${SCOPE_ATTRIBUTE}="${controllerId}"] .ProseMirror`
  const escapedId = escapeAttributeValue(target.id)
  if (target.element.dataset.diffId === target.id) {
    return `${scope} > [data-diff-id="${escapedId}"]`
  }
  if (target.element.dataset.imageDiffId === target.id) {
    return `${scope} > [data-image-diff-id="${escapedId}"]`
  }
  return `${scope} > :nth-child(${target.index + 1})`
}

function transformValue(target: MovingLayoutTarget, progress: number) {
  const remaining = 1 - progress
  const x = Math.round(target.deltaX * remaining * 1000) / 1000
  const y = Math.round(target.deltaY * remaining * 1000) / 1000
  return `translate3d(${x}px,${y}px,0)`
}

function transformRule(controllerId: string, target: MovingLayoutTarget, progress: number) {
  return `${targetSelector(controllerId, target)}{will-change:transform;transform:${transformValue(target, progress)}}`
}

function createExternalTransformAnimation(
  root: HTMLElement,
  controllerId: string,
  targets: MovingLayoutTarget[],
  duration: number,
  onFinish: () => void,
) {
  const scope = root.closest<HTMLElement>('.requirement-editor__content')
    ?? root.parentElement
    ?? root
  const previousScopeId = scope.getAttribute(SCOPE_ATTRIBUTE)
  scope.setAttribute(SCOPE_ATTRIBUTE, controllerId)

  const styleElement = document.createElement('style')
  styleElement.dataset.documentLayoutMotionStyle = controllerId
  const progress = { value: 0 }
  styleElement.textContent = targets
    .map(target => transformRule(controllerId, target, progress.value))
    .join('')
  document.head.append(styleElement)

  const styleRules = Array.from(styleElement.sheet?.cssRules ?? []).filter(
    (rule): rule is CSSStyleRule => 'style' in rule,
  )
  const canUpdateRules = styleRules.length === targets.length
  const render = () => {
    if (canUpdateRules) {
      targets.forEach((target, index) => {
        styleRules[index]!.style.transform = transformValue(target, progress.value)
      })
    } else {
      styleElement.textContent = targets
        .map(target => transformRule(controllerId, target, progress.value))
        .join('')
    }

    root.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
  }

  const tween = gsap.to(progress, {
    value: 1,
    duration,
    ease: 'power2.out',
    overwrite: false,
    onUpdate: render,
    onComplete: onFinish,
    onInterrupt: onFinish,
  })

  return { root, scope, previousScopeId, styleElement, tween }
}

function restoreScope(active: ActiveLayoutMotion, controllerId: string) {
  active.styleElement.remove()
  if (active.scope.getAttribute(SCOPE_ATTRIBUTE) !== controllerId) return
  if (active.previousScopeId === null) active.scope.removeAttribute(SCOPE_ATTRIBUTE)
  else active.scope.setAttribute(SCOPE_ATTRIBUTE, active.previousScopeId)
}

export function attachDocumentLayoutMotion(
  editor: Editor,
  options: DocumentLayoutMotionOptions = {},
) {
  const controllerId = `requirement-layout-${++controllerSequence}`
  const scheduleFrame = options.scheduleFrame ?? window.requestAnimationFrame.bind(window)
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window)
  let pending: PendingLayoutMotion | null = null
  let active: ActiveLayoutMotion | null = null
  let scheduledFrame = 0
  let destroyed = false

  const finishActiveMotion = () => {
    const current = active
    if (!current) return

    active = null
    current.tween.progress(1)
    current.tween.kill()
    restoreScope(current, controllerId)
    current.root.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
  }

  const playPendingMotion = () => {
    scheduledFrame = 0
    const capture = pending
    pending = null
    if (
      !capture
      || destroyed
      || editor.isDestroyed
      || editor.view.dom !== capture.root
      || options.isEnabled?.() === false
      || prefersReducedMotion()
    ) return

    const currentBlocks = collectTopLevelBlockElements(editor, editor.view.state.doc)
    const currentById = new Map(currentBlocks.map(block => [block.id, block]))
    const movingTargets: MovingLayoutTarget[] = []

    capture.capturedIds.forEach((id) => {
      const current = currentById.get(id)
      const previousRect = capture.previousRects.get(id)
      if (!current || !previousRect) return

      const currentRect = current.element.getBoundingClientRect()
      const deltaX = previousRect.left - currentRect.left
      const deltaY = previousRect.top - currentRect.top
      if (
        Math.abs(deltaX) <= MIN_POSITION_DELTA
        && Math.abs(deltaY) <= MIN_POSITION_DELTA
      ) return

      movingTargets.push({ ...current, deltaX, deltaY })
    })

    if (!movingTargets.length) return

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      const current = active
      if (!current) return
      active = null
      restoreScope(current, controllerId)
      capture.root.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
    }

    active = createExternalTransformAnimation(
      capture.root,
      controllerId,
      movingTargets,
      options.duration ?? DEFAULT_DURATION,
      cleanup,
    )
  }

  const handleBeforeTransaction = ({ transaction, nextState }: EditorEvents['beforeTransaction']) => {
    if (
      destroyed
      || pending
      || options.isEnabled?.() === false
      || prefersReducedMotion()
      || editor.view.composing
      || transaction.getMeta(DOCUMENT_LAYOUT_MOTION_META) === false
      || transaction.getMeta('blockId')
      || transaction.getMeta('preventUpdate')
      || !transactionMayChangeBlockStructure(transaction)
    ) return

    const change = describeStructuralLayoutChange(editor.view.state.doc, nextState.doc)
    if (!change) return

    finishActiveMotion()
    const root = editor.view.dom
    const blocks = collectTopLevelBlockElements(editor, editor.view.state.doc)
    const targets = collectCaptureTargets(blocks, change, options.getViewport?.(), options)
    if (!targets.length) return

    const previousRects = new Map<string, DOMRect>()
    targets.forEach(({ id, element }) => previousRects.set(id, element.getBoundingClientRect()))
    pending = {
      root,
      capturedIds: new Set(targets.map(target => target.id)),
      previousRects,
    }
  }

  const handleTransaction = () => {
    if (!pending || scheduledFrame) return
    scheduledFrame = scheduleFrame(playPendingMotion)
  }

  editor.on('beforeTransaction', handleBeforeTransaction)
  editor.on('transaction', handleTransaction)

  return () => {
    destroyed = true
    editor.off('beforeTransaction', handleBeforeTransaction)
    editor.off('transaction', handleTransaction)
    if (scheduledFrame) cancelFrame(scheduledFrame)
    scheduledFrame = 0
    pending = null
    finishActiveMotion()
  }
}
