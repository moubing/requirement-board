import type { BingScrollbarExpose } from '@moubing/bing-ui'
import { revealDetailsAncestors } from '../components/editor/details-visibility'

export function scrollToContent(scrollbar: BingScrollbarExpose | null, element?: HTMLElement | null, topInset = 0) {
  const viewport = scrollbar?.viewport
  if (!viewport || !element || !viewport.contains(element)) return
  revealDetailsAncestors(element, true)
  const target = element.getBoundingClientRect()
  const top = target.top - viewport.getBoundingClientRect().top + viewport.scrollTop
    - Math.max(topInset, (viewport.clientHeight - target.height) / 2)
  scrollbar?.scrollTo({
    top,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
}
