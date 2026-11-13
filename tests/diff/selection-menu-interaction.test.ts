// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import { createSelectionMenuPointerController } from '../../app/components/editor/selection-menu-interaction'

function pointerEvent(
  target: EventTarget,
  overrides: Partial<Pick<PointerEvent, 'button' | 'isPrimary' | 'pointerId'>> = {},
) {
  return {
    button: 0,
    isPrimary: true,
    pointerId: 1,
    target,
    ...overrides,
  } as PointerEvent
}

describe('selection menu pointer interaction', () => {
  it('keeps the menu suppressed until the pointer selection settles and finishes layout', () => {
    const surface = document.createElement('div')
    const text = document.createElement('span')
    surface.append(text)
    const onSelectionStart = vi.fn()
    const onSelectionEnd = vi.fn()
    let scheduledEndDelay: (() => void) | undefined
    let scheduledEnd: FrameRequestCallback | undefined
    const controller = createSelectionMenuPointerController({
      getSurface: () => surface,
      onSelectionStart,
      onSelectionEnd,
      settleDelay: 180,
      scheduleDelay: (callback, delay) => {
        expect(delay).toBe(180)
        scheduledEndDelay = callback
        return 10
      },
      cancelDelay: vi.fn(),
      scheduleFrame: (callback) => {
        scheduledEnd = callback
        return 1
      },
      cancelFrame: vi.fn(),
    })

    controller.handlePointerDown(pointerEvent(text, { pointerId: 7 }))
    expect(controller.isSuppressed()).toBe(true)
    expect(onSelectionStart).toHaveBeenCalledOnce()

    controller.handlePointerEnd(pointerEvent(text, { pointerId: 8 }))
    expect(controller.isSuppressed()).toBe(true)
    expect(scheduledEndDelay).toBeUndefined()
    expect(scheduledEnd).toBeUndefined()

    controller.handlePointerEnd(pointerEvent(text, { pointerId: 7 }))
    expect(controller.isSuppressed()).toBe(true)
    expect(scheduledEndDelay).toBeTypeOf('function')
    expect(onSelectionEnd).not.toHaveBeenCalled()

    scheduledEndDelay?.()
    expect(controller.isSuppressed()).toBe(true)
    expect(onSelectionEnd).not.toHaveBeenCalled()

    scheduledEnd?.(0)
    expect(controller.isSuppressed()).toBe(false)
    expect(onSelectionEnd).toHaveBeenCalledOnce()
  })

  it('ignores secondary pointers and controls outside editable content', () => {
    const surface = document.createElement('div')
    const controls = document.createElement('div')
    controls.contentEditable = 'false'
    const button = document.createElement('button')
    controls.append(button)
    surface.append(controls)
    const onSelectionStart = vi.fn()
    const controller = createSelectionMenuPointerController({
      getSurface: () => surface,
      onSelectionStart,
      onSelectionEnd: vi.fn(),
      scheduleDelay: vi.fn(() => 2),
      cancelDelay: vi.fn(),
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    })

    controller.handlePointerDown(pointerEvent(surface, { button: 2 }))
    controller.handlePointerDown(pointerEvent(surface, { isPrimary: false }))
    controller.handlePointerDown(pointerEvent(button))

    expect(controller.isSuppressed()).toBe(false)
    expect(onSelectionStart).not.toHaveBeenCalled()
  })

  it('coalesces consecutive clicks into one reveal after the last click settles', () => {
    const surface = document.createElement('div')
    const text = document.createElement('span')
    surface.append(text)
    const onSelectionStart = vi.fn()
    const onSelectionEnd = vi.fn()
    const scheduledDelays = new Map<number, () => void>()
    let nextDelayHandle = 10
    const cancelDelay = vi.fn((handle: number) => scheduledDelays.delete(handle))
    let scheduledEnd: FrameRequestCallback | undefined
    const cancelFrame = vi.fn()
    const controller = createSelectionMenuPointerController({
      getSurface: () => surface,
      onSelectionStart,
      onSelectionEnd,
      scheduleDelay: (callback) => {
        const handle = nextDelayHandle++
        scheduledDelays.set(handle, callback)
        return handle
      },
      cancelDelay,
      scheduleFrame: (callback) => {
        scheduledEnd = callback
        return 20
      },
      cancelFrame,
    })

    controller.handlePointerDown(pointerEvent(text, { pointerId: 2 }))
    controller.handlePointerEnd(pointerEvent(text, { pointerId: 2 }))
    controller.handlePointerDown(pointerEvent(text, { pointerId: 3 }))
    controller.handlePointerEnd(pointerEvent(text, { pointerId: 3 }))

    expect(controller.isSuppressed()).toBe(true)
    expect(onSelectionStart).toHaveBeenCalledOnce()
    expect(onSelectionEnd).not.toHaveBeenCalled()
    expect(cancelDelay).toHaveBeenCalledWith(10)
    expect(scheduledDelays.has(10)).toBe(false)
    expect(scheduledDelays.has(11)).toBe(true)
    expect(cancelFrame).not.toHaveBeenCalled()

    scheduledDelays.get(11)?.()
    scheduledEnd?.(0)

    expect(controller.isSuppressed()).toBe(false)
    expect(onSelectionEnd).toHaveBeenCalledOnce()
  })

  it('does not reveal the menu after a cancelled pointer gesture', () => {
    const surface = document.createElement('div')
    const onSelectionEnd = vi.fn()
    const controller = createSelectionMenuPointerController({
      getSurface: () => surface,
      onSelectionStart: vi.fn(),
      onSelectionEnd,
      scheduleDelay: vi.fn(() => 3),
      cancelDelay: vi.fn(),
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    })

    controller.handlePointerDown(pointerEvent(surface, { pointerId: 4 }))
    controller.handlePointerCancel(pointerEvent(surface, { pointerId: 4 }))

    expect(controller.isSuppressed()).toBe(false)
    expect(onSelectionEnd).not.toHaveBeenCalled()
  })
})
