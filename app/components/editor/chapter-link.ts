import type { Editor } from '@tiptap/core'
import { bingToast } from '@moubing/bing-ui'

export const chapterHeadingSelector = 'h1[data-diff-id],h2[data-diff-id],h3[data-diff-id]'

export function findChapterHeading(root: HTMLElement, id: string) {
  // ID 来自 URL 或历史正文，不能直接插入 CSS 选择器。
  return Array.from(root.querySelectorAll<HTMLElement>(chapterHeadingSelector)).find(node => node.dataset.diffId === id) ?? null
}

export function caretChapterHeading(editor: Editor) {
  if (!editor.state.selection.empty) return null
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'heading' || ![1, 2, 3].includes(node.attrs.level)) continue
    const element = editor.view.nodeDOM($from.before(depth))
    return element instanceof HTMLElement ? element : null
  }
  return null
}

export function chapterLinkUrl(origin: string, requirementId: string, headingId: string) {
  const url = new URL(`/requirements/${encodeURIComponent(requirementId)}`, origin)
  url.searchParams.set('block', headingId)
  return url.href
}

export async function copyChapterLink(requirementId: string, headingId: string) {
  if (!requirementId || !headingId) return
  try {
    await navigator.clipboard.writeText(chapterLinkUrl(location.origin, requirementId, headingId))
    bingToast.success({ id: 'chapter-link', message: '章节链接已复制', position: 'top-center' })
  } catch {
    bingToast.error({ id: 'chapter-link', message: '复制失败，请检查剪贴板权限后重试', position: 'top-center' })
  }
}
