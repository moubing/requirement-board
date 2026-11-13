import { describe, expect, it, vi } from 'vitest'

import {
  claimUploadedImageTransition,
  discardUploadedImageTransition,
  stageUploadedImageTransition,
} from '../../app/components/editor/uploaded-image-transition'

describe('uploaded image transition handoff', () => {
  it('hands a local preview to the new node exactly once and releases it once', () => {
    const releasePreview = vi.fn()
    stageUploadedImageTransition('img_claimed', 'blob:preview', releasePreview)

    const transition = claimUploadedImageTransition('img_claimed')
    expect(transition?.previewUrl).toBe('blob:preview')
    expect(claimUploadedImageTransition('img_claimed')).toBeNull()

    transition?.release()
    transition?.release()
    expect(releasePreview).toHaveBeenCalledOnce()
  })

  it('can return preview ownership to a failed insertion without revoking it', () => {
    const releasePreview = vi.fn()
    stageUploadedImageTransition('img_failed', 'blob:failed', releasePreview)

    expect(discardUploadedImageTransition('img_failed', false)).toBe(true)
    expect(releasePreview).not.toHaveBeenCalled()
    expect(claimUploadedImageTransition('img_failed')).toBeNull()
  })
})
