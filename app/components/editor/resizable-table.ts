import { Table, type TableOptions } from '@tiptap/extension-table'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { columnResizing, columnResizingPluginKey, tableEditing } from '@tiptap/pm/tables'
import { ScrollbarTableView, updateTableColumns } from './scrollbar-node-views'
import { captureTableColumn, resolveTableColumn, tableColumnWidthTransaction, TABLE_MIN_COLUMN_WIDTH, type TableColumnTarget } from './table-column-width'
import { dispatchIsolatedHistory } from './isolated-history'
import { EDITOR_ACTIVITY_CHANGE_EVENT, EDITOR_IMAGE_RESIZE_EVENT, EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'

/** 复用 TableKit 的边线命中、装饰及 TableView，补充取消、协作身份与独立撤销边界。 */
function columnResizePlugin(isActive: () => boolean) {
  const native = columnResizing({ handleWidth: 4, cellMinWidth: TABLE_MIN_COLUMN_WIDTH, defaultCellMinWidth: TABLE_MIN_COLUMN_WIDTH, View: ScrollbarTableView })
  let view: EditorView
  let disposed = false
  let coarse: MediaQueryList | undefined
  let drag: { target: TableColumnTarget; startX: number; startWidth: number; width: number } | undefined
  const enabled = () => Boolean(!disposed && view?.editable && isActive() && !coarse?.matches)
  const notify = () => view.dom.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
  const state = () => columnResizingPluginKey.getState(view.state)
  function paint(target: TableColumnTarget, width?: number) {
    const column = resolveTableColumn(view.state.doc, target)
    const wrapper = column && view.nodeDOM(column.pos)
    const table = wrapper instanceof HTMLElement ? wrapper.querySelector('table') : null
    if (!column || !table?.firstElementChild) return false
    updateTableColumns(column.node, table.firstElementChild as HTMLTableColElement, table, TABLE_MIN_COLUMN_WIDTH,
      width === undefined ? undefined : column.column, width)
    notify()
    return true
  }
  function finish(commit = false) {
    if (!drag) return
    const current = drag; drag = undefined
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', cancel)
    document.removeEventListener('visibilitychange', visibility)
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: false }))
    if (view.isDestroyed) return
    if (disposed) { paint(current.target); return }
    const transaction = commit && enabled() && Math.abs(current.width - current.startWidth) >= 1
      ? tableColumnWidthTransaction(view.state, current.target, current.width) : null
    if (transaction) dispatchIsolatedHistory(view, transaction)
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, commit ? { setDragging: null } : { setHandle: -1 }))
    paint(current.target)
  }
  function cancel() { finish(false) }
  function visibility() { if (document.hidden) cancel() }
  function key(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }
  function move(event: MouseEvent) {
    if (!drag) return
    if (!enabled() || !(event.buttons & 1)) { cancel(); return }
    drag.width = Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(drag.startWidth + event.clientX - drag.startX))
    if (!paint(drag.target, drag.width)) cancel()
  }
  function up(event: MouseEvent) {
    if (!drag) return
    drag.width = Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(drag.startWidth + event.clientX - drag.startX))
    finish(true)
  }
  function start(event: MouseEvent) {
    if (!enabled() || event.button !== 0 || drag) return false
    const handle = state()?.activeHandle ?? -1
    const target = handle >= 0 ? captureTableColumn(view.state, handle) : null
    const column = target && resolveTableColumn(view.state.doc, target)
    if (!target || !column) return false
    event.preventDefault()
    view.focus()
    if (event.detail > 1) return true
    const wrapper = view.nodeDOM(column.pos) as HTMLElement
    const col = wrapper.querySelectorAll('col')[column.column]
    const width = col?.getBoundingClientRect().width ?? TABLE_MIN_COLUMN_WIDTH
    drag = { target, startX: event.clientX, startWidth: width, width }
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX: event.clientX, startWidth: width } }))
    view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: true }))
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', visibility)
    return true
  }
  function reset(event: MouseEvent) {
    if (!enabled()) return false
    const handle = state()?.activeHandle ?? -1
    const target = handle >= 0 ? captureTableColumn(view.state, handle) : null
    if (!target) return false
    event.preventDefault()
    const transaction = tableColumnWidthTransaction(view.state, target, null)
    if (transaction) dispatchIsolatedHistory(view, transaction)
    paint(target)
    return true
  }
  function checkActivity() {
    if (enabled()) return
    cancel()
    if (!disposed && !view.isDestroyed && (state()?.activeHandle ?? -1) >= 0) view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }))
  }
  return new Plugin({
    ...native.spec,
    props: {
      ...native.props,
      attributes: (): Record<string, string> => enabled() && (state()?.activeHandle ?? -1) >= 0 ? { class: 'resize-cursor', 'data-bing-cursor': 'col-resize' } : {},
      decorations: state => enabled() ? native.props.decorations?.call(native, state) : null,
      handleDOMEvents: {
        mousemove: (editorView, event) => enabled() ? native.props.handleDOMEvents?.mousemove?.call(native, editorView, event) : false,
        mouseleave: (editorView, event) => native.props.handleDOMEvents?.mouseleave?.call(native, editorView, event),
        mousedown: (_view, event) => start(event),
        dblclick: (_view, event) => reset(event),
      },
    },
    view(editorView) {
      view = editorView
      disposed = false
      coarse = window.matchMedia('(pointer: coarse)')
      coarse.addEventListener('change', checkActivity)
      view.dom.addEventListener(EDITOR_ACTIVITY_CHANGE_EVENT, checkActivity)
      // Tiptap 动态注册插件时会重建全部 plugin view；清除上一实例的拖动装饰。
      queueMicrotask(() => {
        if (!disposed && !view.isDestroyed && !drag && state()?.dragging) view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }))
      })
      return {
        update(_view, previous) {
          if (!enabled()) { queueMicrotask(checkActivity); return }
          if (drag && previous.doc !== view.state.doc && !paint(drag.target, drag.width)) queueMicrotask(cancel)
        },
        destroy() { disposed = true; cancel(); coarse?.removeEventListener('change', checkActivity); view.dom.removeEventListener(EDITOR_ACTIVITY_CHANGE_EVENT, checkActivity) },
      }
    },
  })
}

export const ResizableTable = Table.extend<TableOptions & { isActive: () => boolean }>({
  addOptions() { return { ...this.parent!(), isActive: () => true, resizable: true, handleWidth: 4, cellMinWidth: TABLE_MIN_COLUMN_WIDTH } },
  addProseMirrorPlugins() { return [columnResizePlugin(this.options.isActive), tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection })] },
  addNodeView() { return ({ node, view, HTMLAttributes }) => new ScrollbarTableView(node, TABLE_MIN_COLUMN_WIDTH, view, HTMLAttributes) },
})
