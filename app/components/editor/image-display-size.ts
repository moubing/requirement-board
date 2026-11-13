export interface ImageDisplaySize {
  width: number
  height: number
}

export const DEFAULT_IMAGE_DISPLAY_SIZE: ImageDisplaySize = {
  width: 480,
  height: 270,
}

const MAX_IMAGE_WIDTH = 720
const MIN_IMAGE_WIDTH = 120
const MIN_IMAGE_HEIGHT = 80

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function fitImageDisplaySize(
  naturalWidth: number,
  naturalHeight: number,
  availableWidth = MAX_IMAGE_WIDTH,
): ImageDisplaySize {
  const safeNaturalWidth = positiveNumber(naturalWidth)
  const safeNaturalHeight = positiveNumber(naturalHeight)
  const safeAvailableWidth = positiveNumber(availableWidth) ?? MAX_IMAGE_WIDTH
  if (!safeNaturalWidth || !safeNaturalHeight) return { ...DEFAULT_IMAGE_DISPLAY_SIZE }

  const width = Math.min(safeNaturalWidth, safeAvailableWidth, MAX_IMAGE_WIDTH)
  const naturalRatio = safeNaturalWidth / safeNaturalHeight
  return {
    width: Math.max(MIN_IMAGE_WIDTH, Math.round(width)),
    height: Math.max(MIN_IMAGE_HEIGHT, Math.round(width / naturalRatio)),
  }
}

export function hasMatchingImageRatio(
  width: unknown,
  height: unknown,
  naturalWidth: number,
  naturalHeight: number,
) {
  const storedWidth = positiveNumber(width)
  const storedHeight = positiveNumber(height)
  const safeNaturalWidth = positiveNumber(naturalWidth)
  const safeNaturalHeight = positiveNumber(naturalHeight)
  if (!storedWidth || !storedHeight || !safeNaturalWidth || !safeNaturalHeight) return false

  const storedRatio = storedWidth / storedHeight
  const naturalRatio = safeNaturalWidth / safeNaturalHeight
  return Math.abs(storedRatio - naturalRatio) / naturalRatio < 0.01
}
