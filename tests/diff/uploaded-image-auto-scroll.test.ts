import { describe, expect, it } from 'vitest'

import { resolveDownwardRevealScrollTarget } from '../../app/components/editor/use-uploaded-image-auto-scroll'

describe('uploaded image auto scroll', () => {
  it('does not move when the uploaded image is already fully visible', () => {
    expect(resolveDownwardRevealScrollTarget({
      elementBottom: 780,
      viewportBottom: 800,
      currentScrollTop: 500,
      maxScrollTop: 2000,
    })).toBeNull()
  })

  it('scrolls only far enough to reveal the clipped bottom with a breathing gap', () => {
    expect(resolveDownwardRevealScrollTarget({
      elementBottom: 900,
      viewportBottom: 800,
      currentScrollTop: 500,
      maxScrollTop: 2000,
    })).toBe(624)
  })

  it('caps the target at the editor scroll limit', () => {
    expect(resolveDownwardRevealScrollTarget({
      elementBottom: 1600,
      viewportBottom: 800,
      currentScrollTop: 500,
      maxScrollTop: 900,
    })).toBe(900)
  })

  it('does not request a scroll when the editor cannot move any farther', () => {
    expect(resolveDownwardRevealScrollTarget({
      elementBottom: 810,
      viewportBottom: 800,
      currentScrollTop: 900,
      maxScrollTop: 900,
    })).toBeNull()
  })
})
