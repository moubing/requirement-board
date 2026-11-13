import { defineComponent, h, nextTick, render } from 'vue'
import { BingScrollbar, type BingScrollbarExpose, type BingScrollbarViewportSlotProps } from '@moubing/bing-ui'
import { NamedCodeBlock } from '~~/shared/editor/code-block'
import { TableView, updateColumns } from '@tiptap/extension-table'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import RequirementCodeBlockNode from './RequirementCodeBlockNode.vue'
import { createCodeHighlightPlugin } from './code-highlight-decoration'

// 只包裹 NodeView 的 DOM；正文内容仍由 ProseMirror 管理，不改变 schema 或序列化。
function mountNodeScrollbar(content: HTMLElement, className: string, label: string) {
  const dom = document.createElement('div')
  dom.className = className
  let scrollbar: BingScrollbarExpose | null = null
  // NodeView 在 Vue 渲染上下文外创建；让组件实例拥有 ref，卸载时才能正常清理。
  const NodeScrollbar = defineComponent({
    setup: () => () => h(BingScrollbar, {
      horizontal: true,
      vertical: false,
      focusable: false,
      ref: (instance) => { scrollbar = instance as unknown as BingScrollbarExpose | null },
    }, {
      viewport: ({ viewportRef, viewportAttrs }: BingScrollbarViewportSlotProps) => h('div', {
        ...viewportAttrs,
        class: [viewportAttrs.class, 'requirement-node-scroll__viewport'],
        role: 'region',
        'aria-label': label,
        ref: (element) => {
          viewportRef(element)
          if (element instanceof HTMLElement && content.parentElement !== element) element.append(content)
        },
      }),
    }),
  })
  render(h(NodeScrollbar), dom)
  return {
    dom,
    update: () => { void nextTick(() => scrollbar?.update()) },
    destroy: () => render(null, dom),
  }
}

export function updateTableColumns(node: ProseMirrorNode, colgroup: HTMLTableColElement, table: HTMLTableElement, minWidth: number, overrideCol?: number, overrideWidth?: number) {
  updateColumns(node, colgroup, table, minWidth, overrideCol, overrideWidth)
  // TableKit 从固定宽切回自动宽时只写 min-width，必须移除上次预览留下的 width。
  let index = 0
  node.firstChild?.forEach(cell => {
    for (let offset = 0; offset < cell.attrs.colspan; offset++, index++) {
      const col = colgroup.children[index] as HTMLTableColElement
      const fixed = index === overrideCol ? overrideWidth : cell.attrs.colwidth?.[offset]
      col.style.width = fixed ? `${fixed}px` : ''
      col.style.minWidth = fixed ? '' : `${minWidth}px`
    }
  })
}

export class ScrollbarTableView extends TableView {
  private readonly scrollbar

  constructor(node: ProseMirrorNode, cellMinWidth: number, view: EditorView, attributes: Record<string, unknown> = {}) {
    super(node, cellMinWidth, view, attributes)
    this.scrollbar = mountNodeScrollbar(this.table, 'tableWrapper', '正文表格')
    this.dom = this.scrollbar.dom
  }

  override update(node: ProseMirrorNode) {
    const updated = super.update(node)
    if (updated) {
      updateTableColumns(node, this.colgroup, this.table, this.cellMinWidth)
      this.scrollbar.update()
    }
    return updated
  }

  stopEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest('.bing-scrollbar__rail'))
  }

  destroy() { this.scrollbar.destroy() }
}

export const ScrollbarCodeBlock = NamedCodeBlock.extend({
  addProseMirrorPlugins() { return [...(this.parent?.() ?? []), createCodeHighlightPlugin()] },
  addNodeView() {
    return VueNodeViewRenderer(RequirementCodeBlockNode)
  },
})
