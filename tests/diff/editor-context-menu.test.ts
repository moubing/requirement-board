// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import { resolveEditorContextTarget } from '../../app/components/editor/editor-context-menu'

afterEach(() => {
  document.body.replaceChildren()
})

describe('editor context menu target resolution', () => {
  it('resolves a table cell with its row and column label', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr><td>第一格</td><td>第二格</td></tr>
          <tr><td>第三格</td><td><span id="target">第四格</span></td></tr>
        </tbody>
      </table>
    `

    expect(resolveEditorContextTarget(document.querySelector('#target'))).toMatchObject({
      kind: 'table',
      label: '第 2 行 · 第 2 列',
    })
  })

  it('prefers an image or link context over a containing table', () => {
    document.body.innerHTML = `
      <table><tbody><tr><td>
        <figure class="requirement-image"><img id="image" alt="架构图"></figure>
        <a id="link" href="https://example.com/docs">接口文档</a>
      </td></tr></tbody></table>
    `

    expect(resolveEditorContextTarget(document.querySelector('#image'))).toMatchObject({
      kind: 'image',
      label: '架构图',
    })
    expect(resolveEditorContextTarget(document.querySelector('#link'))).toMatchObject({
      kind: 'link',
      label: '接口文档',
      href: 'https://example.com/docs',
    })
  })

  it('keeps an editable image caption in the text context', () => {
    document.body.innerHTML = `
      <figure class="requirement-image">
        <img alt="架构图">
        <figcaption class="requirement-image__caption"><span id="caption">说明文字</span></figcaption>
      </figure>
    `

    expect(resolveEditorContextTarget(document.querySelector('#caption')).kind).toBe('text')
  })
})
