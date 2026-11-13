import { defaultBlockAt, findParentNode, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { RequirementDetails, RequirementDetailsContent, RequirementDetailsSummary as BaseDetailsSummary } from '~~/shared/editor/details'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'
import { REVEAL_DETAILS_EVENT, revealDetailsAncestors } from './details-visibility'

// 每个编辑器会话独立；NodeView 重绘、远端更新和撤销不会重置已选状态。
const sessions = new WeakMap<Editor, Map<string, boolean>>()
function states(editor: Editor) {
  let state = sessions.get(editor)
  if (!state) { state = new Map(); sessions.set(editor, state) }
  return state
}
function showContent(content: HTMLElement, open: boolean) {
  if (open) content.removeAttribute('hidden')
  else content.setAttribute('hidden', 'until-found')
}

export const EditableDetails = RequirementDetails.extend({
  addKeyboardShortcuts() {
    const leaveSummary = (direction: 'down' | 'right') => {
      const { state, view } = this.editor
      const { $head, empty } = state.selection
      if (!empty || $head.parent.type.name !== 'detailsSummary'
        || states(this.editor).get($head.node(-1).attrs.diffId)
        || (direction === 'right' && $head.parentOffset !== $head.parent.content.size)) return false
      view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve($head.after(-1)), 1)).scrollIntoView())
      return true
    }
    return {
      ...this.parent?.(),
      // until-found 使用 content-visibility，不能沿用官方 offsetParent 可见性判断。
      Enter: ({ editor }) => {
        const { state, view } = editor, { $head } = state.selection
        if ($head.parent.type.name !== 'detailsSummary') return false
        const open = states(editor).get($head.node(-1).attrs.diffId) ?? false
        const above = open ? state.doc.nodeAt($head.after()) : $head.node(-2)
        const after = open ? 0 : $head.indexAfter(-1)
        const type = above && defaultBlockAt(above.contentMatchAt(after))
        const node = type?.createAndFill()
        if (!above || !type || !node || !above.canReplaceWith(after, after, type)) return false
        const pos = open ? $head.after() + 1 : $head.after(-1)
        const tr = state.tr.insert(pos, node)
        view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(pos), 1)).scrollIntoView())
        return true
      },
      ArrowDown: () => leaveSummary('down'),
      ArrowRight: () => leaveSummary('right'),
    }
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('requirementDetailsSelection'),
      appendTransaction: (transactions, oldState, state) => {
        if (this.editor.view.composing || !oldState.selection.empty || !state.selection.empty
          || !transactions.some(tr => tr.selectionSet)) return
        const { $from } = state.selection
        for (let depth = 1; depth < $from.depth; depth++) {
          const parent = $from.node(depth)
          if (parent.type.name !== 'details' || $from.index(depth) !== 1 || states(this.editor).get(parent.attrs.diffId)) continue
          const summaryStart = $from.start(depth) + 1
          const pos = oldState.selection.from < state.selection.from ? summaryStart : summaryStart + parent.firstChild!.content.size
          return state.tr.setSelection(TextSelection.create(state.doc, pos))
        }
      },
    })]
  },
  addNodeView() {
    return ({ editor, node }) => {
      let current = node
      const state = states(editor)
      let open = state.get(String(node.attrs.diffId)) ?? false
      const dom = document.createElement('div')
      dom.dataset.type = 'details'
      dom.className = 'requirement-details'
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.contentEditable = 'false'
      toggle.className = 'requirement-details__toggle'
      const contentDOM = document.createElement('div')
      contentDOM.className = 'requirement-details__body'
      dom.append(toggle, contentDOM)
      const render = () => {
        dom.dataset.diffId = current.attrs.diffId ?? ''
        dom.classList.toggle('is-open', open)
        toggle.setAttribute('aria-expanded', String(open))
        toggle.setAttribute('aria-label', `${open ? '收起' : '展开'}折叠块${current.firstChild?.textContent ? `：${current.firstChild.textContent}` : ''}`)
        const content = contentDOM.querySelector<HTMLElement>(':scope > [data-type="detailsContent"]')
        if (content) showContent(content, open)
      }
      const setOpen = (value: boolean) => {
        if (open === value) return
        open = value
        if (current.attrs.diffId) state.set(current.attrs.diffId, open)
        render()
        editor.view.dom.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
      }
      const click = () => setOpen(!open)
      const reveal = () => setOpen(true)
      toggle.addEventListener('click', click)
      dom.addEventListener(REVEAL_DETAILS_EVENT, reveal)
      render()
      return {
        dom, contentDOM,
        update(next) {
          if (next.type !== current.type) return false
          if (current.attrs.diffId && next.attrs.diffId !== current.attrs.diffId) open = state.get(next.attrs.diffId) ?? false
          current = next
          if (current.attrs.diffId) state.set(current.attrs.diffId, open)
          render()
          return true
        },
        stopEvent: event => toggle.contains(event.target as Node),
        ignoreMutation: mutation => mutation.type !== 'selection' && (mutation.target === dom || toggle.contains(mutation.target)),
        destroy() { toggle.removeEventListener('click', click); dom.removeEventListener(REVEAL_DETAILS_EVENT, reveal) },
      }
    }
  },
})

export const EditableDetailsContent = RequirementDetailsContent.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: ({ editor }) => {
        const { state, view } = editor, { $from, empty } = state.selection
        const content = findParentNode(node => node.type === this.type)(state.selection)
        // 稳定 diffId 不影响“尾部空段”的判定；保留至少一个内容块。
        if (!empty || !content || $from.depth !== content.depth + 1 || $from.parent.type.name !== 'paragraph'
          || $from.parent.content.size || $from.index(content.depth) !== content.node.childCount - 1) return false
        const pos = $from.after(content.depth - 1), $after = state.doc.resolve(pos)
        const type = defaultBlockAt($after.parent.contentMatchAt($after.index()))
        const node = type?.createAndFill()
        if (!type || !node || !$after.parent.canReplaceWith($after.index(), $after.index(), type)) return false
        const tr = state.tr
        if (content.node.childCount > 1) tr.delete($from.before(), $from.after())
        const insertion = tr.mapping.map(pos)
        tr.insert(insertion, node)
        view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(insertion), 1)).scrollIntoView())
        return true
      },
    }
  },
  addNodeView() {
    return ({ editor, getPos, node }) => {
      const dom = document.createElement('div')
      dom.dataset.type = 'detailsContent'
      const pos = getPos()
      const parent = typeof pos === 'number' ? editor.state.doc.resolve(pos).parent : null
      showContent(dom, states(editor).get(String(parent?.attrs.diffId)) ?? false)
      const reveal = () => revealDetailsAncestors(dom)
      dom.addEventListener('beforematch', reveal)
      return {
        dom, contentDOM: dom,
        update: next => next.type === node.type,
        ignoreMutation: mutation => mutation.type !== 'selection' && mutation.target === dom && mutation.type === 'attributes',
        destroy: () => dom.removeEventListener('beforematch', reveal),
      }
    }
  },
})

export const RequirementDetailsSummary = BaseDetailsSummary.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('summary')
      const render = (current: typeof node) => {
        dom.dataset.diffId = current.attrs.diffId ?? ''
        dom.dataset.empty = String(current.content.size === 0)
      }
      render(node)
      return {
        dom, contentDOM: dom,
        update(next) { if (next.type !== node.type) return false; render(next); return true },
        ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === dom,
      }
    }
  },
})
