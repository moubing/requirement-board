export const REVEAL_DETAILS_EVENT = 'rb:reveal-details'

/** 所有定位入口先展开目标的祖先；不创建正文事务或改变选区。 */
export function revealDetailsAncestors(target: Node | null, includeContents = false) {
  let element = target instanceof HTMLElement ? target : target?.parentElement
  if (includeContents && element) {
    if (element.matches('[data-type="details"]')) element.dispatchEvent(new Event(REVEAL_DETAILS_EVENT))
    element.querySelectorAll('[data-type="details"]').forEach(details => details.dispatchEvent(new Event(REVEAL_DETAILS_EVENT)))
  }
  while (element) {
    if (element.matches('[data-type="detailsContent"]')) {
      element.closest('[data-type="details"]')?.dispatchEvent(new Event(REVEAL_DETAILS_EVENT))
    }
    element = element.parentElement
  }
}

export function isInsideClosedDetails(target: Element | null) {
  return !!target?.closest('[data-type="detailsContent"][hidden]')
}
