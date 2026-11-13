// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BlockId } from '../../app/components/editor/block-id-extension'
import { canHighlightCode, codeColorRanges, CodeHighlightTask, highlightedCode } from '../../app/components/editor/code-highlight'
import { applyCodeHighlight, codeHighlightKey, createCodeHighlightPlugin } from '../../app/components/editor/code-highlight-decoration'
import { setCodeBlockLanguage, setCodeBlockTitle } from '../../app/components/editor/code-block-commands'
import { NamedCodeBlock } from '../../shared/editor/code-block'
import { parseRichTextDocument } from '../../shared/editor/validation'
import { extractSelectionHistoryBlocks } from '../../shared/diff/selection-history'
import { extractPlainText } from '../../shared/editor/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'

const { highlight } = vi.hoisted(() => ({ highlight: vi.fn() }))
vi.mock('@moubing/bing-ui', async importOriginal => ({ ...await importOriginal<object>(), highlightCode: highlight }))
const tasks: CodeHighlightTask[] = [], editors: Editor[] = []
let intersection: (entries: { isIntersecting: boolean }[]) => void
beforeEach(() => {
  vi.useFakeTimers()
  highlight.mockReset().mockImplementation(async (text: string) => text.split('\n').map((content, i) => ({ number: i + 1, tokens: [{ content, color: '#123456' }] })))
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof intersection) { intersection = callback } observe() {} disconnect() {} })
})
afterEach(() => {
  tasks.splice(0).forEach(task => task.destroy())
  editors.splice(0).forEach(editor => editor.destroy())
  vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren()
})

describe('代码高亮调度', () => {
  it('保留 UTF-16 偏移与 CRLF，遇到解析结果不一致时回退', () => {
    const lines = [{ number: 1, tokens: [{ content: '😀', color: '#123' }] }, { number: 2, tokens: [{ content: 'x', color: '#456' }] }]
    expect(codeColorRanges('😀\r\nx', lines)).toEqual([{ from: 0, to: 2, color: '#123' }, { from: 4, to: 5, color: '#456' }])
    expect(codeColorRanges('different', lines)).toEqual([])
  })
  it('仅支持明确语言，限制按行数和 UTF-8 字节计算', () => {
    expect(canHighlightCode('x', 'unknown')).toBe(false)
    expect(canHighlightCode('x', 'text')).toBe(false)
    expect(canHighlightCode('x\n'.repeat(1999), 'ts')).toBe(true)
    expect(canHighlightCode('x\n'.repeat(2000), 'ts')).toBe(false)
    expect(canHighlightCode('中'.repeat(35000), 'ts')).toBe(false)
    expect(canHighlightCode('x'.repeat(102400), 'ts')).toBe(true)
  })
  it('不可见时不申请高亮，150ms 防抖只处理最后文本，重复内容复用缓存', async () => {
    const state = { text: 'visible-a', language: 'ts' }
    const apply = vi.fn()
    const task = new CodeHighlightTask(document.createElement('div'), () => state, apply); tasks.push(task)
    task.update(); await vi.runAllTimersAsync(); expect(highlight).not.toHaveBeenCalled()
    intersection([{ isIntersecting: true }]); await vi.runAllTimersAsync()
    expect(highlight).toHaveBeenCalledTimes(1)
    state.text = 'visible-b'; task.update(); await vi.advanceTimersByTimeAsync(100)
    state.text = 'visible-c'; task.update(); await vi.advanceTimersByTimeAsync(149)
    expect(highlight).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync(); expect(highlight).toHaveBeenCalledTimes(2)
    const cached = highlightedCode('visible-c', 'typescript', 'vitesse-light')
    await vi.runAllTimersAsync(); await cached
    expect(highlight).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledTimes(2)
  })
  it('组词、失活和移出视口取消待处理结果，结束组词后恢复', async () => {
    const state = { text: 'ime-a', language: 'ts' }
    const apply = vi.fn()
    const task = new CodeHighlightTask(document.createElement('div'), () => state, apply); tasks.push(task)
    intersection([{ isIntersecting: true }]); task.setComposing(true)
    state.text = 'ime-组词'; task.update(); await vi.runAllTimersAsync()
    expect(highlight).not.toHaveBeenCalled()
    task.setComposing(false); await vi.runAllTimersAsync(); expect(apply).toHaveBeenCalledTimes(1)
    state.text = 'ime-hidden'; task.update(); task.setActive(false)
    await vi.runAllTimersAsync(); expect(apply).toHaveBeenCalledTimes(1)
    task.setActive(true); intersection([{ isIntersecting: false }])
    await vi.runAllTimersAsync(); expect(apply).toHaveBeenCalledTimes(1)
    intersection([{ isIntersecting: true }]); await vi.runAllTimersAsync(); expect(apply).toHaveBeenCalledTimes(2)
  })
  it('异步返回后检查请求版本，不把旧内容的颜色套到新文本', async () => {
    let finish: (value: unknown) => void = () => {}
    highlight.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const state = { text: 'pending-original', language: 'ts' }, apply = vi.fn()
    const task = new CodeHighlightTask(document.createElement('div'), () => state, apply); tasks.push(task)
    intersection([{ isIntersecting: true }]); await vi.advanceTimersByTimeAsync(5)
    state.text = 'pending-new'; task.update()
    finish([{ number: 1, tokens: [{ content: 'pending-original', color: '#123' }] }])
    await vi.advanceTimersByTimeAsync(5); expect(apply).not.toHaveBeenCalled()
    await vi.runAllTimersAsync(); expect(apply).toHaveBeenCalledTimes(1)
  })
  it('删除后快速撤销恢复旧原文，复用缓存但重新应用被删除的装饰', async () => {
    const state = { text: 'undo-decoration', language: 'ts' }, apply = vi.fn()
    const task = new CodeHighlightTask(document.createElement('div'), () => state, apply); tasks.push(task)
    intersection([{ isIntersecting: true }]); await vi.runAllTimersAsync()
    state.text = ''; task.update()
    state.text = 'undo-decoration'; task.update(); await vi.runAllTimersAsync()
    expect(highlight).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledTimes(2)
  })
  it('加载失败静默回退且允许再次请求', async () => {
    highlight.mockRejectedValueOnce(new Error('offline'))
    const failed = highlightedCode('retry-content', 'ts', 'vitesse-light')
    await vi.runAllTimersAsync(); expect(await failed).toEqual([])
    const retry = highlightedCode('retry-content', 'ts', 'vitesse-light')
    await vi.runAllTimersAsync(); expect(await retry).toHaveLength(1)
  })
})

describe('代码语言与装饰', () => {
  function mount() {
    const editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), NamedCodeBlock, BlockId], content: { type: 'doc', content: [
      { type: 'codeBlock', attrs: { diffId: 'code', language: 'javascript' }, content: [{ type: 'text', text: 'const a = 1\n' }] },
      { type: 'paragraph', attrs: { diffId: 'tail' } },
    ] } }); editors.push(editor); editor.registerPlugin(createCodeHighlightPlugin()); return editor
  }
  it('语言变化计入属性 Diff、独立撤销重做，原文与 diffId 不变', () => {
    const editor = mount(), before = editor.getJSON()
    editor.commands.setTextSelection(2); editor.commands.insertContent('x')
    const typed = editor.getJSON()
    expect(setCodeBlockLanguage(editor, 'code', 'ts')).toBe(true)
    expect(buildRichTextDiff(typed as never, editor.getJSON() as never).pairs[0]?.status).toBe('modified')
    expect(extractPlainText(editor.getJSON() as never)).toBe(extractPlainText(typed as never))
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(typed)
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before)
    editor.commands.redo(); editor.commands.redo()
    expect(editor.getJSON().content?.[0]?.attrs).toEqual({ diffId: 'code', language: 'typescript', title: null })
    editor.setEditable(false); expect(setCodeBlockLanguage(editor, 'code', 'json')).toBe(false)
  })
  it('名称参与属性 Diff，支持独立撤销、HTML 往返和清空，名称不混入代码原文', () => {
    const editor = mount(), before = editor.getJSON()
    editor.commands.setTextSelection(2); editor.commands.insertContent('x')
    const typed = editor.getJSON()
    expect(setCodeBlockTitle(editor, 'code', '  示例 <main>.ts  ')).toBe(true)
    const named = editor.getJSON()
    expect(named.content?.[0]?.attrs).toMatchObject({ diffId: 'code', title: '示例 <main>.ts', language: 'javascript' })
    expect(buildRichTextDiff(typed as never, named as never).pairs[0]?.status).toBe('modified')
    expect(extractPlainText(named as never)).toBe(extractPlainText(typed as never))
    expect(editor.getText()).not.toContain('示例')
    const copy = new Editor({ extensions: [StarterKit.configure({ codeBlock: false }), NamedCodeBlock, BlockId], content: editor.getHTML() })
    editors.push(copy)
    expect(copy.getJSON().content?.[0]).toEqual(named.content?.[0])
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(typed)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
    editor.commands.redo(); editor.commands.redo(); expect(editor.getJSON()).toEqual(named)
    setCodeBlockTitle(editor, 'code', '  ')
    expect(editor.getJSON()).toEqual(typed)
    editor.setEditable(false); expect(setCodeBlockTitle(editor, 'code', '禁止')).toBe(false)
  })
  it('服务端接受旧块与可选名称，拒绝非法名称；缺省名称不产生虚假历史变化', () => {
    const editor = mount(), current = editor.getJSON()
    const legacy = structuredClone(current)
    delete legacy.content![0]!.attrs!.title
    expect(parseRichTextDocument(legacy)).toEqual(legacy)
    expect(buildRichTextDiff(legacy as never, current as never).counts.modified).toBe(0)
    expect(extractSelectionHistoryBlocks(legacy as never)[0]?.attrsSignature).toBe(extractSelectionHistoryBlocks(current as never)[0]?.attrsSignature)
    for (const title of [null, 'main.ts', '中文名称😀']) {
      current.content![0]!.attrs!.title = title
      expect(() => parseRichTextDocument(current)).not.toThrow()
    }
    for (const title of [3, {}, 'x'.repeat(121), '多\n行', '\u0000']) {
      current.content![0]!.attrs!.title = title
      expect(() => parseRichTextDocument(current)).toThrow(/Code block title/)
    }
  })
  it('装饰不改 JSON、HTML、选区、撤销；文档变化后映射并移除过期颜色', () => {
    const editor = mount(), before = editor.getJSON(), owner = {}
    editor.commands.setTextSelection(2)
    applyCodeHighlight(editor.view, 0, owner, [{ from: 0, to: 5, color: '#123456' }])
    expect(codeHighlightKey.getState(editor.state)?.find()).toHaveLength(1)
    expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.from).toBe(2)
    expect(editor.getHTML()).not.toContain('requirement-code-token'); expect(editor.can().undo()).toBe(false)
    editor.commands.insertContent('x')
    expect(codeHighlightKey.getState(editor.state)?.find()[0]?.to).toBe(7)
    applyCodeHighlight(editor.view, 0, owner, [])
    expect(codeHighlightKey.getState(editor.state)?.find()).toHaveLength(0)
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before)
  })
})
