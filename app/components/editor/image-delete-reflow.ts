import { gsap } from 'gsap'

type FlipPlugin = typeof import('gsap/Flip')['Flip']

interface ReflowTargetOptions {
  viewportHeight?: number
  overscan?: number
  maxTargets?: number
}

interface ActiveReflow {
  targets: HTMLElement[]
  timeline: gsap.core.Timeline
}

export interface FollowingBlockReflow {
  play: () => void
}

const DEFAULT_OVERSCAN = 32
const DEFAULT_MAX_TARGETS = 48
const activeReflows = new WeakMap<HTMLElement, ActiveReflow>()

function viewportHeight() {
  return document.documentElement.clientHeight || window.innerHeight
}

function clearReflowStyles(targets: HTMLElement[]) {
  if (targets.length) gsap.set(targets, { clearProps: 'transform,willChange' })
}

function finishActiveReflow(root: HTMLElement) {
  const active = activeReflows.get(root)
  if (!active) return

  activeReflows.delete(root)
  active.timeline.progress(1)
  active.timeline.kill()
  clearReflowStyles(active.targets)
}

export function collectFollowingBlockReflowTargets(
  imageNode: HTMLElement,
  options: ReflowTargetOptions = {},
) {
  const root = imageNode.parentElement
  if (!root) return []

  const siblings = Array.from(root.children)
  const imageIndex = siblings.indexOf(imageNode)
  if (imageIndex < 0) return []

  const imageRect = imageNode.getBoundingClientRect()
  const overscan = Math.max(0, options.overscan ?? DEFAULT_OVERSCAN)
  const maxTargets = Math.max(1, options.maxTargets ?? DEFAULT_MAX_TARGETS)
  const revealBottom = (options.viewportHeight ?? viewportHeight())
    + Math.max(0, imageRect.height)
    + overscan
  const revealTop = -overscan
  const targets: HTMLElement[] = []

  for (const sibling of siblings.slice(imageIndex + 1)) {
    if (!(sibling instanceof HTMLElement)) continue
    if (sibling.classList.contains('ProseMirror-gapcursor')) continue

    const rect = sibling.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.bottom < revealTop) continue
    if (rect.top > revealBottom) break

    targets.push(sibling)
    if (targets.length >= maxTargets) break
  }

  return targets
}

export function captureFollowingBlockReflow(
  imageNode: HTMLElement,
  Flip: FlipPlugin,
  options: ReflowTargetOptions = {},
): FollowingBlockReflow | null {
  const root = imageNode.parentElement
  if (!root) return null

  finishActiveReflow(root)
  const targets = collectFollowingBlockReflowTargets(imageNode, options)
  if (!targets.length) return null

  const state = Flip.getState(targets, { simple: true })
  let played = false

  return {
    play() {
      if (played) return
      played = true

      const connectedTargets = targets.filter(target => target.parentElement === root)
      if (!connectedTargets.length) return

      gsap.set(connectedTargets, { willChange: 'transform' })
      let timeline: gsap.core.Timeline
      const clearCurrentReflow = () => {
        const active = activeReflows.get(root)
        if (active?.timeline !== timeline) return

        activeReflows.delete(root)
        clearReflowStyles(connectedTargets)
      }

      timeline = Flip.from(state, {
        targets: connectedTargets,
        duration: 0.38,
        ease: 'power2.out',
        simple: true,
        scale: false,
        prune: true,
        overwrite: true,
        onComplete: clearCurrentReflow,
        onInterrupt: clearCurrentReflow,
      })
      activeReflows.set(root, { targets: connectedTargets, timeline })
    },
  }
}
