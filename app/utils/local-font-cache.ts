import { normalizeEditorFont } from './editor-fonts'

export const localFontCacheKey = 'rb-local-fonts'
interface LocalFontCache { families: string[]; persisted: boolean }
// 浏览器拒绝写入时仍保留本页结果，关闭设置再打开不丢失；刷新后以磁盘缓存为准。
let temporaryCache: LocalFontCache | null = null

export function normalizeLocalFontFamilies(values: unknown[]): string[] {
  const unique = new Map<string, string>()
  for (const value of values) {
    const family = normalizeEditorFont(value)
    if (family && !unique.has(family.toLowerCase())) unique.set(family.toLowerCase(), family)
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function readLocalFontCache(): LocalFontCache | null {
  if (typeof window === 'undefined') return null
  if (temporaryCache) return temporaryCache
  try {
    const value = JSON.parse(window.localStorage.getItem(localFontCacheKey) ?? 'null')
    if (value?.version !== 1 || !Array.isArray(value.families)) return null
    return { families: normalizeLocalFontFamilies(value.families), persisted: true }
  } catch { return null }
}

export function saveLocalFontCache(values: unknown[]): LocalFontCache {
  const cache = { families: normalizeLocalFontFamilies(values), persisted: false }
  if (typeof window === 'undefined') return cache
  try {
    const serialized = JSON.stringify({ version: 1, families: cache.families })
    window.localStorage.setItem(localFontCacheKey, serialized)
    cache.persisted = window.localStorage.getItem(localFontCacheKey) === serialized
  } catch { /* 存储被禁用或配额不足时，仍可使用本次读取结果。 */ }
  temporaryCache = cache.persisted ? null : cache
  return cache
}
