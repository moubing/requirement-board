// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'

import {
  captureFollowingBlockReflow,
  collectFollowingBlockReflowTargets,
} from '../../app/components/editor/image-delete-reflow'

type FlipPlugin = typeof import('gsap/Flip')['Flip']

gsap.registerPlugin(Flip)

function setRect(element: HTMLElement, top: number, height: number, width = 600) {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: top,
    top,
    right: width,
    bottom: top + height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  })
}

function appendBlock(root: HTMLElement, top: number, height: number, className?: string) {
  const block = document.createElement('div')
  if (className) block.className = className
  setRect(block, top, height)
  root.append(block)
  return block
}

afterEach(() => {
  gsap.globalTimeline.clear()
  document.body.replaceChildren()
})

describe('image deletion block reflow', () => {
  it('only captures following blocks that are visible or can enter the viewport', () => {
    const root = document.createElement('div')
    appendBlock(root, 20, 40)
    const image = appendBlock(root, 100, 400)
    appendBlock(root, 500, 1, 'ProseMirror-gapcursor')
    const visible = appendBlock(root, 520, 60)
    appendBlock(root, 600, 0)
    const entering = appendBlock(root, 980, 30)
    appendBlock(root, 1033, 40)

    expect(collectFollowingBlockReflowTargets(image, { viewportHeight: 600 })).toEqual([
      visible,
      entering,
    ])
    expect(collectFollowingBlockReflowTargets(image, {
      viewportHeight: 600,
      maxTargets: 1,
    })).toEqual([visible])
  })

  it('captures before deletion and starts one transform-only Flip after deletion', () => {
    const root = document.createElement('div')
    const image = appendBlock(root, 100, 400)
    const following = appendBlock(root, 520, 60)
    document.body.append(root)

    const state = { id: 'before-delete' }
    const timeline = {
      kill: vi.fn(),
      progress: vi.fn(),
    }
    let flipVars: Record<string, unknown> | undefined
    const Flip = {
      getState: vi.fn(() => state),
      from: vi.fn((capturedState, vars) => {
        expect(capturedState).toBe(state)
        flipVars = vars as Record<string, unknown>
        return timeline
      }),
    } as unknown as FlipPlugin

    const reflow = captureFollowingBlockReflow(image, Flip, { viewportHeight: 600 })
    expect(Flip.getState).toHaveBeenCalledWith([following], { simple: true })

    image.remove()
    reflow?.play()
    reflow?.play()

    expect(Flip.from).toHaveBeenCalledOnce()
    expect(flipVars).toMatchObject({
      targets: [following],
      duration: 0.38,
      ease: 'power2.out',
      scale: false,
    })
    expect(following.style.willChange).toBe('transform')

    const complete = flipVars?.onComplete as (() => void) | undefined
    complete?.()
    expect(following.style.willChange).toBe('')
    expect(following.style.transform).toBe('')
  })

  it('visually holds a following block at its old position before moving it upward', async () => {
    const root = document.createElement('div')
    const image = appendBlock(root, 100, 400)
    const following = appendBlock(root, 520, 60)
    document.body.append(root)

    let followingTop = 520
    setRect(following, followingTop, 60)
    following.getBoundingClientRect = () => ({
      x: 0,
      y: followingTop,
      top: followingTop,
      right: 600,
      bottom: followingTop + 60,
      left: 0,
      width: 600,
      height: 60,
      toJSON: () => ({}),
    })

    const reflow = captureFollowingBlockReflow(image, Flip, { viewportHeight: 600 })
    image.remove()
    followingTop = 120
    reflow?.play()

    expect(following.style.transform).not.toBe('')
    expect(following.style.willChange).toBe('transform')

    await new Promise(resolve => window.setTimeout(resolve, 460))
    expect(following.style.transform).toBe('')
    expect(following.style.willChange).toBe('')
  })
})
