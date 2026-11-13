interface PendingUploadedImageTransition {
  previewUrl?: string
  releasePreview: () => void
  releaseTimer: ReturnType<typeof setTimeout>
}

export interface UploadedImageTransitionHandle {
  previewUrl?: string
  release: () => void
}

const pendingTransitions = new Map<string, PendingUploadedImageTransition>()
const PREVIEW_RELEASE_TIMEOUT = 15_000

export function stageUploadedImageTransition(
  diffId: string,
  previewUrl: string | undefined,
  releasePreview: () => void,
) {
  discardUploadedImageTransition(diffId, true)

  let released = false
  let releaseTimer: ReturnType<typeof setTimeout>
  const release = () => {
    if (released) return
    released = true
    clearTimeout(releaseTimer)
    releasePreview()
  }

  releaseTimer = setTimeout(release, PREVIEW_RELEASE_TIMEOUT)
  pendingTransitions.set(diffId, {
    previewUrl,
    releasePreview: release,
    releaseTimer,
  })
}

export function claimUploadedImageTransition(diffId: string): UploadedImageTransitionHandle | null {
  const transition = pendingTransitions.get(diffId)
  if (!transition) return null

  pendingTransitions.delete(diffId)
  return {
    previewUrl: transition.previewUrl,
    release: transition.releasePreview,
  }
}

export function discardUploadedImageTransition(diffId: string, releasePreview: boolean) {
  const transition = pendingTransitions.get(diffId)
  if (!transition) return false

  pendingTransitions.delete(diffId)
  if (releasePreview) transition.releasePreview()
  else clearTimeout(transition.releaseTimer)
  return true
}
