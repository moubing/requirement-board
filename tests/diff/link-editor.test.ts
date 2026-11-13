// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { normalizeLinkHref } from '../../shared/editor/link'

const editors: Editor[] = []

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('link editor href normalization', () => {
  it('keeps supported absolute and relative links', () => {
    expect(normalizeLinkHref(' https://example.com/docs ')).toEqual({
      ok: true,
      href: 'https://example.com/docs',
    })
    expect(normalizeLinkHref('/requirements/req_1')).toEqual({
      ok: true,
      href: '/requirements/req_1',
    })
    expect(normalizeLinkHref('#acceptance-criteria')).toEqual({
      ok: true,
      href: '#acceptance-criteria',
    })
  })

  it('adds useful protocols for domains and email addresses', () => {
    expect(normalizeLinkHref('example.com/docs')).toEqual({
      ok: true,
      href: 'https://example.com/docs',
    })
    expect(normalizeLinkHref('owner@example.com')).toEqual({
      ok: true,
      href: 'mailto:owner@example.com',
    })
  })

  it('rejects incomplete links and unsafe protocols', () => {
    expect(normalizeLinkHref('not-a-link')).toEqual({
      ok: false,
      message: '请输入完整网址，例如 https://example.com',
    })
    expect(normalizeLinkHref('javascript:alert(1)')).toEqual({
      ok: false,
      message: '不支持此链接协议',
    })
    expect(normalizeLinkHref('https://example.com/a path')).toEqual({
      ok: false,
      message: '链接地址中不能包含空格',
    })
  })
})

describe('link editor behavior', () => {
  it('renders a recognizable link and opens it when clicked', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({
          openOnClick: true,
          enableClickSelection: true,
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'requirement-editor__link',
          },
        }),
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '接口文档',
                marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }],
              },
            ],
          },
        ],
      },
    })
    editors.push(editor)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const anchor = editor.view.dom.querySelector('a')

    expect(anchor).not.toBeNull()
    expect(anchor?.classList.contains('requirement-editor__link')).toBe(true)
    expect(anchor?.target).toBe('_blank')
    expect(anchor?.rel).toBe('noopener noreferrer')

    const clickEvent = new MouseEvent('click', { bubbles: true, button: 0 })
    Object.defineProperty(clickEvent, 'target', { value: anchor })
    const clickPlugin = editor.state.plugins.find((plugin) => plugin.key.startsWith('handleClickLink$'))
    const handled = clickPlugin?.props.handleClick?.(editor.view, 1, clickEvent)

    expect(handled).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank')
  })
})
