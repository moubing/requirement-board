import { describe, expect, it } from 'vitest'

import {
  buildImageDiffDisplay,
  buildImageDiffDisplayFromNodes,
} from '../../app/components/diff/image-diff-display'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import type { RichTextDocument } from '../../shared/editor/document'

function imageDocument(width?: number, height?: number): RichTextDocument {
  return {
    type: 'doc',
    content: [
      {
        type: 'image',
        attrs: {
          diffId: 'image_size',
          src: '/architecture.png',
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
        },
        content: [{ type: 'imageCaption', content: [{ type: 'text', text: '架构图' }] }],
      },
    ],
  }
}

describe('image diff display', () => {
  it('uses one scale for both sides so resized images keep their relative dimensions', () => {
    const pair = buildRichTextDiff(
      imageDocument(480, 270),
      imageDocument(640, 360),
    ).pairs[0]!

    expect(buildImageDiffDisplay(pair)).toEqual({
      base: { width: 480, height: 270, previewWidth: 270, previewHeight: 152 },
      target: { width: 640, height: 360, previewWidth: 360, previewHeight: 203 },
      sizeChanged: true,
    })
  })

  it('uses the editor defaults for legacy images without stored dimensions', () => {
    const pair = buildRichTextDiff(
      imageDocument(),
      imageDocument(480, 270),
    ).pairs[0]!
    const display = buildImageDiffDisplay(pair)

    expect(display.base).toMatchObject({ width: 480, height: 270 })
    expect(display.target).toMatchObject({ width: 480, height: 270 })
    expect(display.sizeChanged).toBe(false)
  })

  it('uses the same image sizing for selection-history nodes', () => {
    const baseNode = imageDocument(480, 270).content[0]!
    const targetNode = imageDocument(640, 360).content[0]!

    expect(buildImageDiffDisplayFromNodes(baseNode, targetNode)).toEqual({
      base: { width: 480, height: 270, previewWidth: 270, previewHeight: 152 },
      target: { width: 640, height: 360, previewWidth: 360, previewHeight: 203 },
      sizeChanged: true,
    })
  })
})
