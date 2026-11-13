import { describe, expect, it, vi } from 'vitest'

import { startImageAlignmentMotion } from '../../app/components/editor/image-alignment-motion'

type FlipPlugin = typeof import('gsap/Flip')['Flip']

describe('image alignment motion', () => {
  it('refreshes caret geometry during Flip and once more after cleanup', () => {
    const state = { id: 'centered-image' }
    const timeline = { id: 'alignment-timeline' }
    let flipOptions: Record<string, unknown> | undefined
    const Flip = {
      from: vi.fn((capturedState, options) => {
        expect(capturedState).toBe(state)
        flipOptions = options as Record<string, unknown>
        return timeline
      }),
    } as unknown as FlipPlugin
    const onFrame = vi.fn()
    const onFinish = vi.fn()

    expect(startImageAlignmentMotion(
      Flip,
      state as unknown as ReturnType<FlipPlugin['getState']>,
      { onFrame, onFinish },
    )).toBe(timeline)
    expect(flipOptions).toMatchObject({
      duration: 0.34,
      ease: 'power2.inOut',
      scale: false,
    })

    const update = flipOptions?.onUpdate as (() => void) | undefined
    const complete = flipOptions?.onComplete as (() => void) | undefined
    const interrupt = flipOptions?.onInterrupt as (() => void) | undefined
    update?.()
    expect(onFrame).toHaveBeenCalledOnce()

    complete?.()
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFrame).toHaveBeenCalledTimes(2)

    interrupt?.()
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onFrame).toHaveBeenCalledTimes(2)
  })
})
