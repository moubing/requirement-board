import { Extension, type Editor } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { ANNOTATION_EDIT_EXTERNAL } from './annotation-edit-guard'
import { imageUploadPlaceholderPluginKey } from './image-upload-placeholder'
import { availableSlashCommands, slashRangeAt, type SlashCommand, type SlashRange } from './slash-commands'

export interface SlashMenuState { range: SlashRange; items: SlashCommand[]; index: number }
const key = new PluginKey('requirementSlashCommands')

export function createSlashCommands(options: {
  enabled: () => boolean
  update: (state: SlashMenuState | null) => void
  pickImage: () => void
  allowImage?: () => boolean
}) {
  let editor: Editor
  let view: EditorView | undefined
  let session: SlashRange | null = null
  let menu: SlashMenuState | null = null
  let composing = false
  let historyTime = 0
  let captureTimeout: number | undefined
  let compositionTimer: ReturnType<typeof setTimeout> | undefined
  let pendingStart = false
  let executing = false
  let historyOpen = false
  let firstTransaction = false
  let pickingImage = false
  let uploadId: string | null = null

  function manager() { return view && yUndoPluginKey.getState(view.state)?.undoManager }
  function boundary() {
    manager()?.stopCapturing()
    if (view && !view.isDestroyed) view.dispatch(closeHistory(view.state.tr))
  }
  function begin() {
    if (session || pendingStart || !view || !options.enabled()) return
    manager()?.stopCapturing()
    historyOpen = true
    firstTransaction = true
    historyTime = Date.now()
    const undo = manager()
    if (undo) captureTimeout = undo.captureTimeout
    pendingStart = true
  }
  function close() {
    const hadSession = historyOpen
    historyOpen = false
    pickingImage = false
    uploadId = null
    session = null
    menu = null
    pendingStart = false
    options.update(null)
    const undo = manager()
    if (undo && captureTimeout !== undefined) undo.captureTimeout = captureTimeout
    captureTimeout = undefined
    if (hadSession) boundary()
  }
  function refresh() {
    if (!view || !session || !options.enabled() || !editor.isEditable) {
      menu = null; options.update(null); return
    }
    // 组词时保留已显示的候选与位置，提交后再筛选；文件选择中也不重新打开菜单。
    if (composing || view.composing || pickingImage) return
    const range = slashRangeAt(view.state)
    if (!range || range.from !== session.from) { close(); return }
    const items = availableSlashCommands(editor, range).filter(item => item.id !== 'image' || options.allowImage?.() !== false)
    const index = menu?.range.query === range.query ? Math.min(menu.index, Math.max(0, items.length - 1)) : 0
    session = range
    menu = { range, items, index }
    options.update(menu)
  }
  function select(index: number) {
    if (!menu || composing || view?.composing || !options.enabled() || !editor.isEditable) return false
    const range = slashRangeAt(editor.state)
    if (!range || range.from !== menu.range.from || range.to !== menu.range.to || range.query !== menu.range.query) { close(); return false }
    const command = menu.items[index]
    if (!command || !availableSlashCommands(editor, range).some(item => item.id === command.id)) return false
    if (command.id === 'image') {
      // 文件选择取消时保留原文；收到文件后再删除命令并进入原上传队列。
      menu = null; options.update(null)
      pickingImage = true
      options.pickImage()
      return true
    }
    executing = true
    const result = command.apply!(editor.chain().deleteRange(range)).run()
    executing = false
    close()
    view?.focus()
    return result
  }
  function imagePicked(id: string) {
    if (!session || !view || !editor.isEditable || !options.enabled()) { close(); return false }
    const range = slashRangeAt(view.state)
    if (!range || range.from !== session.from || range.query !== session.query) { close(); return false }
    executing = true
    const result = editor.commands.deleteRange(range)
    executing = false
    if (result) {
      uploadId = id; session = null; pickingImage = false
      view.focus()
    } else close()
    return result
  }
  function imageFinished(id: string) { if (uploadId === id) close() }
  function insertImage(id: string, insert: () => boolean) {
    if (uploadId !== id) return insert()
    executing = true
    try { return insert() }
    finally { executing = false; close() }
  }
  function move(index: number) {
    if (!menu || !menu.items.length || composing || view?.composing) return
    menu = { ...menu, index: (index + menu.items.length) % menu.items.length }
    options.update(menu)
  }

  const extension = Extension.create({
    name: 'slashCommands',
    priority: 1100,
    addProseMirrorPlugins() {
      editor = this.editor
      return [new Plugin({
        key,
        filterTransaction(tr) {
          if (uploadId && !executing && tr.docChanged && !tr.getMeta('blockId')) {
            const source = (tr.getMeta('appendedTransaction') as Transaction | undefined) ?? tr
            const action = source.getMeta(imageUploadPlaceholderPluginKey)
            if (isChangeOrigin(tr) || action?.type !== 'insert' || action.id !== uploadId) {
              uploadId = null
              const undo = manager()
              if (undo && captureTimeout !== undefined) undo.captureTimeout = captureTimeout
              manager()?.stopCapturing()
              closeHistory(tr)
            }
          }
          if ((session || pendingStart || uploadId) && tr.docChanged && !isChangeOrigin(tr) && !tr.getMeta(ANNOTATION_EDIT_EXTERNAL)) {
            if (firstTransaction) { closeHistory(tr); firstTransaction = false }
            const undo = manager()
            // 只扩大本次命令的窗口。不能设 Infinity，否则 stopCapturing 的 0 也会合并前一次输入。
            if (undo && captureTimeout !== undefined) undo.captureTimeout = Math.max(captureTimeout, Date.now() - historyTime + captureTimeout)
            tr.setTime(historyTime)
          }
          return true
        },
        state: {
          init: () => null,
          apply(tr: Transaction) {
            if (executing || tr.getMeta('blockId')) return null
            if (uploadId && tr.selectionSet && !tr.docChanged) uploadId = null
            if (tr.docChanged && (isChangeOrigin(tr) || tr.getMeta(ANNOTATION_EDIT_EXTERNAL) || tr.getMeta('uiEvent') === 'paste' || tr.getMeta('uiEvent') === 'drop')) {
              // 在 view.update 中结束，避免 apply 内派发嵌套事务。
              pendingStart = false; session = null
            } else if ((session || pendingStart) && tr.docChanged) {
              const next = slashRangeAt({ selection: tr.selection })
              if (pendingStart && next && !next.query) { session = next; pendingStart = false }
              else if (session && next && next.from === tr.mapping.map(session.from, -1)) session = next
              else if (!composing) { session = null; pendingStart = false }
            } else if (session && tr.selectionSet && !composing && !view?.composing) {
              const next = slashRangeAt({ selection: tr.selection })
              if (!next || next.from !== session.from || next.to !== session.to) session = null
            }
            return null
          },
        },
        props: {
          handleTextInput(current, from, to, text) {
            if (!options.enabled() || !editor.isEditable || composing || current.composing) return false
            if (!session && !pendingStart && from === to && /^[/／、]$/.test(text)) {
              const next = current.state.tr.insertText(text, from, to)
              if (slashRangeAt({ selection: next.selection })) begin()
            }
            return false
          },
          handleKeyDown(current, event) {
            if (!menu || composing || current.composing || event.isComposing || event.keyCode === 229) return false
            if (event.key === 'Escape') { close(); return true }
            if (event.key === 'ArrowDown') { move(menu.index + 1); return true }
            if (event.key === 'ArrowUp') { move(menu.index - 1); return true }
            if (event.key === 'Enter' || event.key === 'Tab') { select(menu.index); return true }
            if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) close()
            return false
          },
          handleDOMEvents: {
            compositionstart(current) {
              clearTimeout(compositionTimer)
              composing = true
              // 只有能输入触发符的位置才预留历史边界，代码、题注及普通词中组词不受影响。
              if (!session && editor.isEditable && current.state.selection.empty) {
                const next = current.state.tr.insertText('/')
                if (slashRangeAt({ selection: next.selection })) begin()
              }
              return false
            },
            compositionend() {
              clearTimeout(compositionTimer)
              compositionTimer = setTimeout(() => {
                composing = false
                if (!view || view.isDestroyed) return
                const range = slashRangeAt(view.state)
                if (pendingStart && range && !range.query) { session = range; pendingStart = false }
                if (session) refresh(); else close()
              }, 0)
              return false
            },
            blur() { if (menu) close(); return false },
          },
        },
        view(current) {
          view = current
          return {
            update() {
              if (executing) return
              if (!options.enabled() || !editor.isEditable || (!session && !pendingStart && !uploadId && historyOpen)) { close(); return }
              if (session) refresh()
              else if (menu) close()
            },
            destroy() { clearTimeout(compositionTimer); close(); view = undefined },
          }
        },
      })]
    },
  })
  return { extension, close, select, move, imagePicked, imageFinished, insertImage, isPickingImage: () => pickingImage }
}
