import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { captureNodeTarget, nodeAnnotationCapability, annotationNodeCapabilities, type AnnotationNodeRegistry, type AnnotationNodeDom } from '~~/shared/agent/annotations'

/** DOM 只决定本次命中的 PM 节点；身份、内容和能力均从模型及共享注册表读取。 */
function objectNodesAtElement(editor: Editor, element: Element | null, registry: AnnotationNodeRegistry) {
  if (!element || !editor.view.dom.contains(element)) return []
  const matches: { id: string; size: number; element: HTMLElement; dom?: AnnotationNodeDom }[] = []
  editor.state.doc.descendants((node, position) => {
    if (node.isText) return false
    const dom = editor.view.nodeDOM(position)
    if (!(dom instanceof HTMLElement) || !dom.contains(element)) return false
    const capability = nodeAnnotationCapability(node.type.name, registry)?.object
    if (!capability) return
    const excluded = capability.dom?.excludeSelector && element.closest(capability.dom.excludeSelector)
    if (excluded && dom.contains(excluded)) return
    matches.push({ id: node.attrs.diffId, size: node.nodeSize, element: dom, dom: capability.dom })
  })
  return matches.sort((a, b) => a.size - b.size)
}

export function objectTargetsAtElement(editor: Editor, element: Element | null, registry = annotationNodeCapabilities) {
  const nodes = objectNodesAtElement(editor, element, registry)
  if (!nodes.length) return []
  const document = editor.getJSON()
  return nodes.map(node => captureNodeTarget(document, node.id, registry))
}

export function keyboardObjectElement(editor: Editor, focused: EventTarget | null, registry = annotationNodeCapabilities): Element | null {
  if (focused instanceof Element && focused.closest('[contenteditable="false"]') && objectNodesAtElement(editor, focused, registry).length) return focused
  const selection = editor.state.selection
  if (selection instanceof NodeSelection && nodeAnnotationCapability(selection.node.type.name, registry)?.object) return editor.view.nodeDOM(selection.from) as Element
  if (selection instanceof CellSelection) {
    if (selection.$anchorCell.pos !== selection.$headCell.pos) return null
    return editor.view.nodeDOM(selection.$anchorCell.pos) as Element
  }
  if (!selection.empty) return null
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (nodeAnnotationCapability(selection.$from.node(depth).type.name, registry)?.object) return editor.view.nodeDOM(selection.$from.before(depth)) as Element
  }
  return null
}

/** 普通节点默认只接管留白/边缘；适配器可声明图片等独立触屏画面。 */
export function canLongPressObject(editor: Editor, element: Element, x: number, y: number, registry = annotationNodeCapabilities) {
  const target = objectNodesAtElement(editor, element, registry)[0]
  if (!target) return false
  if (target.dom?.touchSurfaceSelector && element.closest(target.dom.touchSurfaceSelector)) return true
  if (element.closest('button, a, input, textarea, [contenteditable="false"]')) return false
  const walker = document.createTreeWalker(target.element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(walker.currentNode)
    if (Array.from(range.getClientRects()).some(rect => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)) return false
  }
  return true
}

export function attachObjectLongPress(editor: Editor, root: HTMLElement) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let start: { id: number; x: number; y: number; target: Element } | undefined
  let suppressUntil = 0, touchingUntil = 0
  let consumedPointer: number | undefined
  const pointers = new Set<number>()
  function cancel() { clearTimeout(timer); timer = undefined; start = undefined }
  function down(event: PointerEvent) {
    if (event.pointerType !== 'touch') return
    pointers.add(event.pointerId); touchingUntil = Date.now() + 1000
    if (pointers.size > 1) { cancel(); return }
    if (!(event.target instanceof Element) || !root.contains(event.target) || !canLongPressObject(editor, event.target, event.clientX, event.clientY)) return
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target }
    timer = setTimeout(() => {
      if (!start?.target.isConnected) return cancel()
      const { target, x, y } = start
      consumedPointer = start.id
      suppressUntil = Date.now() + 1000
      cancel()
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
    }, 500)
  }
  function move(event: PointerEvent) {
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel()
  }
  function up(event: PointerEvent) {
    if (event.pointerType !== 'touch') return
    pointers.delete(event.pointerId)
    if (consumedPointer === event.pointerId) { consumedPointer = undefined; suppressUntil = Date.now() + 1000 }
    touchingUntil = Date.now() + 1000
    cancel()
  }
  function click(event: Event) {
    if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); suppressUntil = 0 }
  }
  function context(event: MouseEvent) {
    if (event.isTrusted && (pointers.size || Date.now() < touchingUntil)) {
      // 原生文字长按不交给 DropDown；自定义长按已打开时屏蔽重复的系统菜单。
      event.stopImmediatePropagation()
      if (Date.now() < suppressUntil) event.preventDefault()
    }
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointermove', move, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  document.addEventListener('scroll', cancel, true)
  root.addEventListener('click', click, true)
  root.addEventListener('contextmenu', context, true)
  return () => {
    cancel(); pointers.clear()
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('pointerup', up, true)
    document.removeEventListener('pointercancel', up, true)
    document.removeEventListener('scroll', cancel, true)
    root.removeEventListener('click', click, true)
    root.removeEventListener('contextmenu', context, true)
  }
}
