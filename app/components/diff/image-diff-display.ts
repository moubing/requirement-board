import type { DiffBlockPair } from '~~/shared/diff/rich-text-diff'
import type { RichTextNode } from '~~/shared/editor/document'
import { DEFAULT_IMAGE_DISPLAY_SIZE } from '../editor/image-display-size'

export interface ImageDiffDimensions {
  width: number
  height: number
}

export interface ImageDiffPreview extends ImageDiffDimensions {
  previewWidth: number
  previewHeight: number
}

export interface ImageDiffDisplay {
  base: ImageDiffPreview | null
  target: ImageDiffPreview | null
  sizeChanged: boolean
}

const MAX_DIFF_IMAGE_WIDTH = 360
const MAX_DIFF_IMAGE_HEIGHT = 220

function positiveDimension(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

function imageDimensions(node: RichTextNode | null): ImageDiffDimensions | null {
  if (node?.type !== 'image') return null
  return {
    width: positiveDimension(node.attrs?.width, DEFAULT_IMAGE_DISPLAY_SIZE.width),
    height: positiveDimension(node.attrs?.height, DEFAULT_IMAGE_DISPLAY_SIZE.height),
  }
}

export function buildImageDiffDisplay(pair: DiffBlockPair): ImageDiffDisplay {
  return buildImageDiffDisplayFromNodes(pair.base?.node ?? null, pair.target?.node ?? null)
}

export function buildImageDiffDisplayFromNodes(
  baseNode: RichTextNode | null,
  targetNode: RichTextNode | null,
): ImageDiffDisplay {
  const baseDimensions = imageDimensions(baseNode)
  const targetDimensions = imageDimensions(targetNode)
  const dimensions = [baseDimensions, targetDimensions].filter(
    (value): value is ImageDiffDimensions => Boolean(value),
  )
  const largestWidth = Math.max(...dimensions.map(size => size.width), 1)
  const largestHeight = Math.max(...dimensions.map(size => size.height), 1)
  const scale = Math.min(
    1,
    MAX_DIFF_IMAGE_WIDTH / largestWidth,
    MAX_DIFF_IMAGE_HEIGHT / largestHeight,
  )

  const preview = (size: ImageDiffDimensions | null): ImageDiffPreview | null => size
    ? {
        ...size,
        previewWidth: Math.max(1, Math.round(size.width * scale)),
        previewHeight: Math.max(1, Math.round(size.height * scale)),
      }
    : null

  return {
    base: preview(baseDimensions),
    target: preview(targetDimensions),
    sizeChanged: Boolean(
      baseDimensions
      && targetDimensions
      && (
        baseDimensions.width !== targetDimensions.width
        || baseDimensions.height !== targetDimensions.height
      ),
    ),
  }
}
