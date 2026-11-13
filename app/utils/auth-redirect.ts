const LOCAL_ORIGIN = 'https://requirement-board.local'

export function resolveAuthRedirect(value: unknown, fallback = '/') {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(candidate)
  } catch {
    return fallback
  }
  if (decoded.startsWith('//') || decoded.includes('\\')) return fallback

  let url: URL
  try {
    url = new URL(candidate, LOCAL_ORIGIN)
  } catch {
    return fallback
  }
  if (url.origin !== LOCAL_ORIGIN || ['/login', '/register'].includes(url.pathname.replace(/\/+$/, ''))) return fallback

  return `${url.pathname}${url.search}${url.hash}`
}
