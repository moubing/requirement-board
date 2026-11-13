import { describe, expect, it } from 'vitest'

import {
  EDITOR_SCROLL_BOTTOM_GAP,
  resolveEditorScrollViewportHeight,
} from '../../app/components/editor/editor-scroll-viewport'

describe('editor scroll viewport', () => {
  it('fills the remaining viewport while preserving the bottom gap', () => {
    expect(resolveEditorScrollViewportHeight({
      viewportHeight: 1200,
      containerDocumentTop: 164,
    })).toBe(1200 - 164 - EDITOR_SCROLL_BOTTOM_GAP)
  })

  it('shrinks when content above the editor grows', () => {
    const originalHeight = resolveEditorScrollViewportHeight({
      viewportHeight: 1000,
      containerDocumentTop: 180,
    })
    const shiftedHeight = resolveEditorScrollViewportHeight({
      viewportHeight: 1000,
      containerDocumentTop: 236,
    })

    expect(shiftedHeight).toBe((originalHeight ?? 0) - 56)
  })

  it('keeps a usable minimum height on short stacked layouts', () => {
    expect(resolveEditorScrollViewportHeight({
      viewportHeight: 720,
      containerDocumentTop: 680,
    })).toBe(280)
  })

  it('rejects invalid geometry', () => {
    expect(resolveEditorScrollViewportHeight({
      viewportHeight: Number.NaN,
      containerDocumentTop: 160,
    })).toBeNull()
  })
})
