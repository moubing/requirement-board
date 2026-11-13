/** 保留既有 Cookie 格式；读回确认浏览器没有静默拒绝写入。失败只影响持久化提示。 */
export function savePreferenceCookie(name: 'rb-preferences' | 'rb-theme', value: unknown): string {
  if (typeof document === 'undefined') return ''
  try {
    const serialized = JSON.stringify(value)
    document.cookie = `${name}=${encodeURIComponent(serialized)};path=/;max-age=31536000;samesite=lax`
    const stored = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)
    if (stored === undefined || JSON.stringify(JSON.parse(decodeURIComponent(stored))) !== serialized) throw new Error('Cookie 写入未生效')
    return ''
  } catch { return '当前效果尚未保存。请允许此站点保存 Cookie 后重试。' }
}
