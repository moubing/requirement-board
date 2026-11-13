import { cancelEditorGeometry, scheduleEditorGeometry } from './editor-geometry'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT, EDITOR_READING_POSITION_RESTORED_EVENT } from './editor-layout-events'

/** 宽度或字体变化只恢复正文 viewport 中的段落位置，不触碰编辑器选区、文档或页面滚动。 */
export function attachReadingAnchor(root: HTMLElement, viewport: HTMLElement, stop: () => void, suspended = () => false) {
  let width = viewport.clientWidth
  const document = root.ownerDocument
  const fontSignature = () => ['body', 'code'].map(kind => document.documentElement.style.getPropertyValue(`--rb-editor-font-${kind}`)).join('|')
  let fonts = fontSignature()
  let restoring = false
  let anchor: { element: HTMLElement | null; id?: string; offset: number; top: number } = { element: null, offset: 0, top: viewport.scrollTop }
  const owner = {}
  const restoreOwner = {}
  const selector = 'h1[data-diff-id],h2[data-diff-id],h3[data-diff-id],p[data-diff-id],pre[data-diff-id],[data-image-diff-id]'
  let candidates: HTMLElement[] | undefined
  let index = 0
  let disposed = false
  // 同一几何帧先测量后写入；恢复阅读位置会递增代次，使恢复前测得的锚点与宽度还原在写入阶段作废。
  let epoch = 0
  const capture = () => {
    if (suspended() || !viewport.clientWidth || viewport.clientWidth !== width || fonts !== fontSignature() || restoring) return
    const measuredEpoch = epoch
    const bounds = viewport.getBoundingClientRect()
    if (!candidates) {
      candidates = Array.from(root.querySelectorAll<HTMLElement>(selector))
      index = Math.max(0, candidates.indexOf(anchor.element!))
    }
    let element: HTMLElement | null = null
    let offset = 0
    if (viewport.scrollTop > 0) {
      // 通常仍在同一可见块。滚动时从上次邻域前进/回退，输入不再从文首测量。
      while (index > 0 && candidates[index - 1]!.getBoundingClientRect().bottom > bounds.top + 1) index--
      for (; index < candidates.length; index++) {
        const candidate = candidates[index]!, rect = candidate.getBoundingClientRect()
        if (rect.height > 0 && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom) { element = candidate; offset = rect.top - bounds.top; break }
        if (rect.top >= bounds.bottom) break
      }
      index = Math.min(index, Math.max(0, candidates.length - 1))
    } else index = 0
    const next = { element, id: element?.dataset.diffId ?? element?.dataset.imageDiffId, offset, top: viewport.scrollTop }
    return () => { if (!disposed && !suspended() && measuredEpoch === epoch) anchor = next }
  }
  const scheduleCapture = () => scheduleEditorGeometry(root, owner, capture)
  const mutations = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))) candidates = undefined
    scheduleCapture()
  })
  mutations.observe(root, { childList: true, subtree: true })
  const restore = () => {
    if (disposed || suspended() || !viewport.clientWidth) return
    restoring = true
    scheduleEditorGeometry(root, restoreOwner, () => {
      if (suspended() || !viewport.clientWidth) return
      const measuredEpoch = epoch
      const element = anchor.element?.isConnected ? anchor.element : anchor.id
        ? root.querySelector<HTMLElement>(`[data-diff-id="${CSS.escape(anchor.id)}"],[data-image-diff-id="${CSS.escape(anchor.id)}"]`) : null
      const top = element
        ? viewport.scrollTop + element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset
        : anchor.top
      const nextWidth = viewport.clientWidth
      const nextFonts = fontSignature()
      return () => {
        if (disposed || suspended() || measuredEpoch !== epoch) return
        stop()
        viewport.scrollTop = top
        width = nextWidth
        fonts = nextFonts
        restoring = false
        // 字体改变也可能只改变行内坐标；显式通知目录、标注、标记和平滑光标重测。
        root.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
        scheduleCapture()
      }
    })
  }
  const observer = new ResizeObserver(() => { if (width !== viewport.clientWidth) restore() })
  const fontObserver = new MutationObserver(() => { if (fonts !== fontSignature()) restore() })
  fontObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  document.fonts?.addEventListener('loadingdone', restore)
  // 阅读位置恢复是程序跳转：旧锚点作废，先以恢复后的像素位置为准，下一帧宽度未变时再细化为段落。
  // 若宽度在细化前变化（如返回时侧栏重新布局），按像素保持，而不是退回恢复前的位置。
  const adoptRestoredPosition = () => {
    if (disposed || !viewport.clientWidth) return
    epoch++
    restoring = false
    anchor = { element: null, offset: 0, top: viewport.scrollTop }
    width = viewport.clientWidth
    fonts = fontSignature()
    scheduleCapture()
  }
  viewport.addEventListener('scroll', scheduleCapture, { passive: true })
  viewport.addEventListener(EDITOR_READING_POSITION_RESTORED_EVENT, adoptRestoredPosition)
  root.addEventListener('input', scheduleCapture)
  observer.observe(viewport)
  scheduleCapture()
  return () => { disposed = true; observer.disconnect(); mutations.disconnect(); fontObserver.disconnect(); document.fonts?.removeEventListener('loadingdone', restore); cancelEditorGeometry(root, owner); cancelEditorGeometry(root, restoreOwner); viewport.removeEventListener('scroll', scheduleCapture); viewport.removeEventListener(EDITOR_READING_POSITION_RESTORED_EVENT, adoptRestoredPosition); root.removeEventListener('input', scheduleCapture) }
}
