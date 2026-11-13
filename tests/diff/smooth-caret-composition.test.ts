// @vitest-environment happy-dom

import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView, type PluginView } from '@tiptap/pm/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  compositionCaretCoordinates,
  createSmoothCaretPlugin,
} from '../../app/components/editor/smooth-caret-extension'
import { EDITOR_ACTIVITY_CHANGE_EVENT, EDITOR_IMAGE_RESIZE_EVENT } from '../../app/components/editor/editor-layout-events'
import { imageUploadPlaceholderPluginKey } from '../../app/components/editor/image-upload-placeholder'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
})
const pluginViews: PluginView[] = []
let frames: Map<number, FrameRequestCallback>
let frameId = 0

function rect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height)
}

function flushFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach(callback => callback(performance.now()))
}

function fixture(isActive = () => true) {
  const host = document.createElement('div')
  const dom = document.createElement('div')
  dom.contentEditable = 'true'
  const text = document.createTextNode('中文拼音')
  dom.append(text)
  host.append(dom)
  document.body.append(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(rect(40, 30, 500, 200))
  const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('中文拼音'))])
  const view = {
    dom,
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1) }),
    composing: false,
    editable: true,
    hasFocus: vi.fn(() => true),
    coordsAtPos: vi.fn(() => rect(80, 50, 0, 20)),
    dispatch: vi.fn(),
  }
  const plugin = createSmoothCaretPlugin(isActive)
  const pluginView = plugin.spec.view!(view as unknown as EditorView)
  pluginViews.push(pluginView)
  const selection = document.getSelection()!
  selection.collapse(text, 0)
  flushFrame()
  flushFrame()
  return {
    view,
    pluginView,
    selection,
    text,
    caret: host.querySelector<HTMLElement>('.requirement-editor__smooth-caret')!,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++frameId
    frames.set(id, callback)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    return [rect(100 + this.startOffset * 10, 50, 0, 20)] as unknown as DOMRectList
  })
})

afterEach(() => {
  pluginViews.splice(0).forEach(pluginView => pluginView.destroy?.())
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('编辑器平滑光标', () => {
  it('同位置的上传占位不改变文字光标的矩形、选区或正文', () => {
    const { view, caret, selection, text, pluginView } = fixture()
    view.state = EditorState.create({ doc: view.state.doc, selection: TextSelection.create(view.state.doc, 3) })
    const state = view.state
    selection.collapse(text, 2)
    view.coordsAtPos.mockReturnValue(rect(400, 200, 0, 250))
    view.coordsAtPos.mockClear()
    const anchor = document.createElement('span')
    anchor.dataset.imageUploadCaretAnchor = 'upload-caret'
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(120, 50, 0, 20))
    view.dom.append(anchor)
    vi.spyOn(imageUploadPlaceholderPluginKey, 'getState').mockReturnValue(DecorationSet.create(state.doc, [
      Decoration.widget(3, () => document.createElement('span'), { id: 'upload-caret', order: 1 }),
    ]))
    pluginView.update?.(view as unknown as EditorView, state)
    flushFrame()
    expect(caret.style.height).toBe('18px')
    expect(caret.style.getPropertyValue('--requirement-caret-x')).toBe('80px')
    expect(caret.style.getPropertyValue('--requirement-caret-y')).toBe('21px')
    expect(view.coordsAtPos).not.toHaveBeenCalled()
    expect(view.state).toBe(state)
    expect(selection.focusNode).toBe(text)
    expect(selection.focusOffset).toBe(2)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('其他位置的上传占位不改变当前文字光标的定位方式', () => {
    const { view, caret, pluginView } = fixture()
    view.state = EditorState.create({ doc: view.state.doc, selection: TextSelection.create(view.state.doc, 3) })
    vi.spyOn(imageUploadPlaceholderPluginKey, 'getState').mockReturnValue(DecorationSet.create(view.state.doc, [
      Decoration.widget(1, () => document.createElement('span'), { id: 'another-upload', order: 1 }),
    ]))
    view.coordsAtPos.mockClear()
    pluginView.update?.(view as unknown as EditorView, view.state)
    flushFrame()
    expect(view.coordsAtPos).toHaveBeenCalledWith(3, 1)
    expect(caret.style.height).toBe('18px')
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('图片缩放期间直接跟随布局并保持常亮，结束后即使位置不变也恢复闪烁和平滑移动', () => {
    const { view, caret, pluginView } = fixture()
    const state = view.state
    vi.advanceTimersByTime(800)
    expect(caret.classList.contains('requirement-editor__smooth-caret--blinking')).toBe(true)
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: true }))
    for (const top of [60, 80, 100, 85, 70]) {
      view.coordsAtPos.mockReturnValue(rect(80, top, 0, 20))
      pluginView.update?.(view as unknown as EditorView, state)
      flushFrame()
      expect(caret.style.getPropertyValue('--requirement-caret-y')).toBe(`${top - 29}px`)
      expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(true)
      expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(false)
      expect(caret.classList.contains('requirement-editor__smooth-caret--blinking')).toBe(false)
    }
    vi.advanceTimersByTime(1200)
    expect(caret.classList.contains('requirement-editor__smooth-caret--blinking')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: false }))
    flushFrame(); flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(true)
    vi.advanceTimersByTime(220)
    expect(caret.classList.contains('requirement-editor__smooth-caret--blinking')).toBe(true)
    expect(view.state).toBe(state)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('连续开始缩放会取消上一轮待恢复的动画帧，隐藏和销毁仍清理计时与监听', () => {
    let active = true
    const { view, caret, pluginView } = fixture(() => active)
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: true }))
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: false }))
    flushFrame()
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: true }))
    flushFrame(); flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(false)
    active = false
    view.dom.dispatchEvent(new Event(EDITOR_ACTIVITY_CHANGE_EVENT))
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: false }))
    flushFrame()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(false)
    active = true
    view.dom.dispatchEvent(new Event(EDITOR_ACTIVITY_CHANGE_EVENT))
    flushFrame(); flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(true)
    pluginView.destroy?.()
    pluginViews.splice(pluginViews.indexOf(pluginView), 1)
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: true }))
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: false }))
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('隐藏后取消帧、停止几何读取，恢复时保留默认平滑光标', () => {
    let active = true
    const { view, caret } = fixture(() => active)
    view.coordsAtPos.mockClear()
    view.dom.dispatchEvent(new FocusEvent('focus'))
    active = false
    view.dom.dispatchEvent(new Event(EDITOR_ACTIVITY_CHANGE_EVENT))
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('selectionchange'))
    flushFrame()
    expect(view.coordsAtPos).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(false)
    active = true
    view.dom.dispatchEvent(new Event(EDITOR_ACTIVITY_CHANGE_EVENT))
    flushFrame(); flushFrame()
    expect(view.coordsAtPos).toHaveBeenCalledTimes(1)
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(true)
  })

  it('读取候选选区的焦点端，保留原始 DOM 选区与正文', () => {
    const { view, selection, text } = fixture()
    selection.setBaseAndExtent(text, 1, text, 3)
    const before = view.dom.innerHTML

    expect(compositionCaretCoordinates(view.dom)).toEqual({ left: 130, top: 50, bottom: 70 })
    expect(selection.anchorNode).toBe(text)
    expect(selection.anchorOffset).toBe(1)
    expect(selection.focusOffset).toBe(3)
    expect(selection.isCollapsed).toBe(false)
    expect(view.dom.innerHTML).toBe(before)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('组词期间保留同一个平滑光标，跟随尚未同步到模型的 DOM 输入', () => {
    const { view, selection, text, caret } = fixture()
    const stateBefore = view.state
    view.coordsAtPos.mockClear()
    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    text.textContent = 'zhongwen'
    selection.collapse(text, 8)
    view.dom.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'zhongwen', bubbles: true }))
    view.dom.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }))
    flushFrame()

    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(true)
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(true)
    expect(view.dom.classList.contains('requirement-editor__surface--smooth-caret')).toBe(true)
    expect(caret.style.getPropertyValue('--requirement-caret-x')).toBe('140px')
    expect(view.coordsAtPos).not.toHaveBeenCalled()
    expect(view.state).toBe(stateBefore)
    expect(view.dispatch).not.toHaveBeenCalled()
  })

  it('允许组词覆盖已有选区，并把连续位置通知合并为一帧', () => {
    const { view, selection, text, caret } = fixture()
    view.state = EditorState.create({ doc: view.state.doc, selection: TextSelection.create(view.state.doc, 1, 4) })
    view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    selection.setBaseAndExtent(text, 1, text, 3)
    document.dispatchEvent(new Event('selectionchange'))
    view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
    expect(frames.size).toBe(1)
    flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(true)
    expect(caret.style.getPropertyValue('--requirement-caret-x')).toBe('90px')

    selection.collapse(text, 2)
    document.dispatchEvent(new Event('selectionchange'))
    flushFrame()
    expect(caret.style.getPropertyValue('--requirement-caret-x')).toBe('80px')
  })

  it('结束组词后恢复模型定位，保留原有动画状态', () => {
    const { view, caret } = fixture()
    view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    flushFrame()
    view.coordsAtPos.mockClear()
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { data: '中文' }))
    flushFrame()
    expect(view.coordsAtPos).toHaveBeenCalledWith(view.state.selection.head, 1)
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(true)
    expect(caret.classList.contains('requirement-editor__smooth-caret--smooth')).toBe(true)
  })

  it('无法测量输入法选区时恢复原生光标，避免显示错误位置', () => {
    const { view, caret } = fixture()
    vi.mocked(Range.prototype.getClientRects).mockReturnValue([] as unknown as DOMRectList)
    view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(false)
    expect(view.dom.classList.contains('requirement-editor__surface--smooth-caret')).toBe(false)
  })

  it('不读取编辑器外部的选区，并在失焦和销毁后清理监听', () => {
    const { view, selection, caret, pluginView } = fixture()
    const outside = document.createTextNode('外部文字')
    document.body.append(outside)
    selection.collapse(outside, 2)
    expect(compositionCaretCoordinates(view.dom)).toBeNull()

    view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    view.hasFocus.mockReturnValue(false)
    view.dom.dispatchEvent(new FocusEvent('blur'))
    flushFrame()
    expect(caret.classList.contains('requirement-editor__smooth-caret--visible')).toBe(false)
    pluginView.destroy?.()
    pluginViews.splice(pluginViews.indexOf(pluginView), 1)
    document.dispatchEvent(new Event('selectionchange'))
    view.dom.dispatchEvent(new CompositionEvent('compositionupdate'))
    expect(frames.size).toBe(0)
    expect(caret.isConnected).toBe(false)
  })
})
