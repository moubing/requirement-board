// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import { clipboardImageFileName, extractClipboardImageFiles } from '../../shared/editor/clipboard'

describe('clipboard images', () => {
  it('extracts image files from clipboard items and ignores other data', () => {
    const image = new File(['image'], 'pasted.png', { type: 'image/png' })
    const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' })

    const result = extractClipboardImageFiles({
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'text/plain', getAsFile: () => textFile },
        { kind: 'file', type: 'image/png', getAsFile: () => image },
      ],
    })

    expect(result).toEqual([image])
  })

  it('falls back to clipboard files when items are unavailable', () => {
    const image = new File(['image'], 'fallback.webp', { type: 'image/webp' })
    expect(extractClipboardImageFiles({ files: [image] })).toEqual([image])
  })

  it('generates a filename for unnamed clipboard images', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789)
    const image = new File(['image'], '', { type: 'image/png' })

    expect(clipboardImageFileName(image, 1)).toBe('clipboard-image-123456789-2.png')
  })
})
