import { describe, expect, it } from 'vitest'

import {
  DEFAULT_IMAGE_DISPLAY_SIZE,
  fitImageDisplaySize,
  hasMatchingImageRatio,
} from '../../app/components/editor/image-display-size'

describe('image display size', () => {
  it('fits large images to the same 720px editor limit while preserving their ratio', () => {
    expect(fitImageDisplaySize(1920, 1080, 1200)).toEqual({ width: 720, height: 405 })
  })

  it('uses the current editor width and keeps the existing minimum dimensions', () => {
    expect(fitImageDisplaySize(1200, 800, 600)).toEqual({ width: 600, height: 400 })
    expect(fitImageDisplaySize(40, 40, 600)).toEqual({ width: 120, height: 80 })
  })

  it('falls back safely and detects stored dimensions with the natural ratio', () => {
    expect(fitImageDisplaySize(0, 0)).toEqual(DEFAULT_IMAGE_DISPLAY_SIZE)
    expect(hasMatchingImageRatio(720, 405, 1920, 1080)).toBe(true)
    expect(hasMatchingImageRatio(480, 270, 800, 600)).toBe(false)
  })
})
