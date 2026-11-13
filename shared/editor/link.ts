export type LinkHrefResult =
  | { ok: true; href: string }
  | { ok: false; message: string }

const BLOCKED_PROTOCOL_PATTERN = /^(?:javascript|data|vbscript|file):/i
const ALLOWED_PROTOCOL_PATTERN = /^(?:https?|mailto|tel):/i
const RELATIVE_LINK_PATTERN = /^(?:#|\/(?!\/)|\.\.?\/)/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeLinkHref(value: string): LinkHrefResult {
  const href = value.trim()

  if (!href) {
    return { ok: false, message: '请输入链接地址' }
  }

  if (/\s/.test(href)) {
    return { ok: false, message: '链接地址中不能包含空格' }
  }

  if (BLOCKED_PROTOCOL_PATTERN.test(href)) {
    return { ok: false, message: '不支持此链接协议' }
  }

  if (RELATIVE_LINK_PATTERN.test(href)) {
    return { ok: true, href }
  }

  if (EMAIL_PATTERN.test(href)) {
    return { ok: true, href: `mailto:${href}` }
  }

  if (ALLOWED_PROTOCOL_PATTERN.test(href)) {
    if (/^https?:/i.test(href) && !isValidHttpUrl(href)) {
      return { ok: false, message: '请输入有效的网址' }
    }

    return { ok: true, href }
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    return { ok: false, message: '仅支持网页、邮箱、电话或站内链接' }
  }

  const webHref = href.startsWith('//') ? `https:${href}` : `https://${href}`
  if (isValidHttpUrl(webHref) && new URL(webHref).hostname.includes('.')) {
    return { ok: true, href: webHref }
  }

  return { ok: false, message: '请输入完整网址，例如 https://example.com' }
}
