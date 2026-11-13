import { describe, expect, it } from 'vitest'

import {
  collectRequirementOutline,
  resolveActiveOutlineIds,
  resolveOutlineScrollTarget,
  resolveOutlineTrackGeometry,
} from '../../app/components/editor/requirement-outline-logic'
import type { RichTextDocument } from '../../shared/editor/document'

describe('requirement outline', () => {
  it('collects level 1 to 3 headings in document order and keeps stable ids', () => {
    const document: RichTextDocument = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { diffId: 'heading_intro', level: 1 },
          content: [{ type: 'text', text: '产品概览' }],
        },
        {
          type: 'paragraph',
          attrs: { diffId: 'paragraph_body' },
          content: [{ type: 'text', text: '正文' }],
        },
        {
          type: 'heading',
          attrs: { diffId: 'heading_detail', level: 2 },
          content: [
            { type: 'text', text: '交互' },
            { type: 'text', text: '  细节' },
          ],
        },
        {
          type: 'heading',
          attrs: { diffId: 'heading_empty', level: 3 },
        },
        {
          type: 'heading',
          attrs: { diffId: 'heading_unsupported', level: 4 },
          content: [{ type: 'text', text: '不应显示' }],
        },
      ],
    }

    expect(collectRequirementOutline(document)).toEqual([
      { id: 'heading_intro', label: '产品概览', level: 1 },
      { id: 'heading_detail', label: '交互 细节', level: 2 },
      { id: 'heading_empty', label: '未命名标题', level: 3 },
    ])
  })

  it('activates every heading that is visible in the editor viewport', () => {
    expect(resolveActiveOutlineIds(
      [
        { id: 'h1', top: 84, bottom: 120 },
        { id: 'h2', top: 230, bottom: 266 },
        { id: 'h3', top: 474, bottom: 516 },
        { id: 'h4', top: 620, bottom: 660 },
      ],
      100,
      500,
    )).toEqual(['h1', 'h2', 'h3'])
  })

  it('falls back to the latest preceding heading between sections', () => {
    expect(resolveActiveOutlineIds(
      [
        { id: 'h1', top: -320, bottom: -280 },
        { id: 'h2', top: -40, bottom: -8 },
        { id: 'h3', top: 620, bottom: 652 },
      ],
      100,
      500,
    )).toEqual(['h2'])
  })

  it('resolves a clamped editor-internal scroll target', () => {
    expect(resolveOutlineScrollTarget({
      targetTop: 720,
      viewportTop: 200,
      currentScrollTop: 300,
      maxScrollTop: 1200,
    })).toBe(792)

    expect(resolveOutlineScrollTarget({
      targetTop: 2200,
      viewportTop: 200,
      currentScrollTop: 800,
      maxScrollTop: 1200,
    })).toBe(1200)
  })

  it('stretches the animated rail from the first to the last active item', () => {
    expect(resolveOutlineTrackGeometry({
      railTop: 100,
      railHeight: 160,
      items: [
        { id: 'h1', top: 100, bottom: 132 },
        { id: 'h2', top: 136, bottom: 168 },
        { id: 'h3', top: 172, bottom: 204 },
        { id: 'h4', top: 208, bottom: 260 },
      ],
      activeIds: ['h2', 'h3'],
      pixelRatio: 1,
    })).toEqual({
      y: 36,
      scaleY: 68 / 160,
    })

    expect(resolveOutlineTrackGeometry({
      railTop: 100,
      railHeight: 160,
      items: [
        { id: 'h1', top: 100, bottom: 132 },
        { id: 'h2', top: 136, bottom: 168 },
        { id: 'h3', top: 172, bottom: 204 },
        { id: 'h4', top: 208, bottom: 260 },
      ],
      activeIds: ['h1', 'h4'],
    })).toEqual({ y: 0, scaleY: 1 })
  })
})
