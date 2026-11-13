import { Extension } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { resolveAnnotation, type AiAnnotation } from '~~/shared/agent/annotations'
import { ensureBlockIds } from '~~/shared/editor/document'
import { dispatchIsolatedHistory, ISOLATED_HISTORY } from './isolated-history'

export const ANNOTATION_EDIT_EXTERNAL = 'annotationEditExternal'
const approvedKey = new PluginKey('annotationEditApproved')

/** 只比较仍可定位的标注；失效的旧标注继续由侧栏提示，不猜测它的新位置。 */
export function invalidatedAnnotationIds(transaction: Transaction, notes: AiAnnotation[]) {
  if (!transaction.docChanged || transaction.before.eq(transaction.doc) || !notes.length) return []
  const before = transaction.before.toJSON()
  // 拆段/粘贴尚未执行 BlockId 的追加事务。只规范化副本，避免新块缺 ID 影响其他标注的判断。
  const after = ensureBlockIds(transaction.doc.toJSON())
  return notes.filter(note => resolveAnnotation(note, before).status !== 'unresolved'
    && resolveAnnotation(note, after).status === 'unresolved').map(note => note.id)
}

export function createAnnotationEditGuard(options: {
  enabled: () => boolean
  annotations: () => AiAnnotation[]
  request: (ids: string[] | null) => void
  remove: (ids: string[]) => void
  stale: () => void
}) {
  let view: EditorView | undefined
  let pending: { transaction: Transaction; ids: string[]; composition?: boolean } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function clear() {
    clearTimeout(timer)
    timer = undefined
    pending = undefined
    options.request(null)
  }
  function cancel() {
    clear()
    // Tiptap 对被过滤的事务直接返回，需把浏览器的临时输入 DOM 恢复到未修改状态。
    if (view && !view.isDestroyed) view.updateState(view.state)
  }
  function present() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!pending || !view || view.isDestroyed) return
      view.updateState(view.state)
      options.request(pending.ids)
    }, 0)
  }
  function confirm() {
    if (!pending || !view || view.isDestroyed) return
    if (!options.enabled() || !pending.transaction.before.eq(view.state.doc)) {
      cancel()
      options.stale()
      return
    }
    const { transaction, ids, composition } = pending
    const affected = composition ? ids.filter(id => options.annotations().some(note => note.id === id))
      : invalidatedAnnotationIds(transaction, options.annotations())
    if (affected.some(id => !ids.includes(id))) {
      pending.ids = affected
      options.request(affected)
      return
    }
    clear()
    options.remove(affected)
    // 输入法先确认再开始组词，不重放尚未确认的拼音候选。
    if (composition) return
    // 原事务只应用一次，保留输入、选区和撤销语义；不把未经确认的正文写入 Yjs。
    transaction.setMeta(approvedKey, true).setTime(Date.now()).scrollIntoView()
    if (transaction.getMeta(ISOLATED_HISTORY)) dispatchIsolatedHistory(view, transaction)
    else view.dispatch(transaction)
  }

  const extension = Extension.create({
    name: 'annotationEditGuard',
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction(transaction) {
          // 远端同步/协作撤销已经写入 Yjs，不能在视图层拒绝；外部装载和 ID 修复也不弹确认。
          if (isChangeOrigin(transaction) || transaction.getMeta(ANNOTATION_EDIT_EXTERNAL)
            || transaction.getMeta('blockId') || transaction.getMeta(approvedKey) || !options.enabled()) return true
          if (pending) return !transaction.docChanged
          const ids = invalidatedAnnotationIds(transaction, options.annotations())
          if (!ids.length) return true
          pending = { transaction, ids }
          present()
          return false
        },
        props: {
          handleDOMEvents: {
            compositionstart(current) {
              if (pending || !options.enabled()) return false
              // composition 输入不可取消；在组词开始时检查插入位置，避免过滤中间态破坏原生候选。
              // 探测事务从不派发，确认后由用户继续正常组词。
              const ids = invalidatedAnnotationIds(current.state.tr.insertText('\uFFFC'), options.annotations())
              if (ids.length) {
                pending = { transaction: current.state.tr, ids, composition: true }
                present()
              }
              return false
            },
          },
        },
        view(instance) {
          view = instance
          return {
            update(current) {
              if (pending && !pending.transaction.before.eq(current.state.doc)) {
                clear()
                options.stale()
              }
            },
            destroy() { clear(); view = undefined },
          }
        },
      })]
    },
  })
  return { extension, confirm, cancel }
}
