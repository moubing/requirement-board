import { getCodeLanguages, highlightCode, normalizeCodeLanguage, resolveCodeTheme, type BingCodeBlockLine } from '@moubing/bing-ui'

export interface CodeColorRange { from: number; to: number; color: string }
export type CodeThemeMode = 'light' | 'dark' | 'system'
export const codeLanguageOptions = [{ value: 'text', label: '纯文本' }, ...getCodeLanguages()]
const supported = new Set(getCodeLanguages().map(language => language.value))
const cache = new Map<string, { bytes: number; result: Promise<CodeColorRange[]> }>()
let cacheBytes = 0

export function codeLanguageLabel(language: unknown) {
  const normalized = normalizeCodeLanguage(typeof language === 'string' ? language : '')
  return codeLanguageOptions.find(option => option.value === normalized)?.label ?? normalized
}

export function canHighlightCode(text: string, language: string) {
  if (!supported.has(normalizeCodeLanguage(language)) || text.length > 100 * 1024) return false
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text[i] === '\n' && ++lines > 2000) return false
  return new TextEncoder().encode(text).length <= 100 * 1024
}

/** 仅映射颜色，保持原有字重、行高与 UTF-16 位置；解析器没有还原原文时回退。 */
export function codeColorRanges(text: string, lines: BingCodeBlockLine[]): CodeColorRange[] {
  const original = text.split('\n')
  if (lines.length !== original.length) return []
  const result: CodeColorRange[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = original[index]!
    const tokens = lines[index]!.tokens
    const content = tokens.map(token => token.content).join('')
    if (content !== line && !(line.endsWith('\r') && content === line.slice(0, -1))) return []
    let cursor = offset
    for (const token of tokens) {
      const end = cursor + token.content.length
      if (end > cursor && token.color && /^#[\da-f]{3,8}$/i.test(token.color)) {
        result.push({ from: cursor, to: end, color: token.color })
      }
      cursor = end
    }
    offset += line.length + 1
  }
  return result
}

export function highlightedCode(text: string, language: string, theme: string): Promise<CodeColorRange[]> {
  language = normalizeCodeLanguage(language)
  if (!canHighlightCode(text, language)) return Promise.resolve([])
  const key = `${language}\0${theme}\0${text}`
  const existing = cache.get(key)
  if (existing) { cache.delete(key); cache.set(key, existing); return existing.result }
  // 块之间让出一个任务，避免多个首次进入视口的代码块集中占用同一帧。
  const result = new Promise<void>(resolve => setTimeout(resolve, 0))
    .then(() => highlightCode(text, language, theme)).then(lines => codeColorRanges(text, lines))
    .catch(() => {
      const current = cache.get(key)
      if (current?.result === result) { cacheBytes -= current.bytes; cache.delete(key) }
      return []
    })
  const bytes = key.length * 2
  cache.set(key, { bytes, result }); cacheBytes += bytes
  while (cache.size > 32 || cacheBytes > 2 * 1024 * 1024) {
    const oldest = cache.keys().next().value!
    cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest)
  }
  return result
}

const themeListeners = new Set<() => void>()
let observer: MutationObserver | undefined
let media: MediaQueryList | undefined
function notifyTheme() { themeListeners.forEach(listener => listener()) }
function observeTheme(listener: () => void) {
  themeListeners.add(listener)
  if (!observer) {
    observer = new MutationObserver(notifyTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bing-theme'] })
    media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', notifyTheme)
    document.addEventListener('visibilitychange', notifyTheme)
  }
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size) return
    observer?.disconnect(); observer = undefined
    media?.removeEventListener('change', notifyTheme); media = undefined
    document.removeEventListener('visibilitychange', notifyTheme)
  }
}

/** 一个视图块一个任务；只在可见、激活且非组词时申请/应用结果。 */
export class CodeHighlightTask {
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private visible = false
  private active = true
  private composing = false
  private disposed = false
  private applied = ''
  private observed = ''
  private readonly intersection: IntersectionObserver
  private readonly stopTheme: () => void

  constructor(private element: HTMLElement, private input: () => { text: string; language: string; mode?: CodeThemeMode }, private apply: (ranges: CodeColorRange[]) => void) {
    this.intersection = new IntersectionObserver(entries => {
      this.visible = entries.some(entry => entry.isIntersecting)
      this.update(0)
    }, { rootMargin: '160px 0px' })
    this.intersection.observe(element)
    this.stopTheme = observeTheme(() => this.update(0))
  }

  setActive(value: boolean) { this.active = value; this.update(0) }
  setComposing(value: boolean) { this.composing = value; this.update() }
  update(delay = 150) {
    clearTimeout(this.timer); this.generation++
    if (this.disposed) return
    const input = this.input()
    const theme = resolveCodeTheme('auto', input.mode)
    const key = `${normalizeCodeLanguage(input.language)}\0${theme}\0${input.text}`
    // 删除再撤销可能已丢失装饰；即使文字回到旧值，也需要从缓存重新应用。
    if (key !== this.observed) { this.observed = key; this.applied = '' }
    if (!this.visible || !this.active || this.composing || document.hidden) return
    if (key === this.applied) return
    const generation = this.generation
    this.timer = setTimeout(async () => {
      const ranges = await highlightedCode(input.text, input.language, theme)
      if (this.disposed || generation !== this.generation || this.composing || document.hidden) return
      this.applied = key
      this.element.dataset.codeHighlight = ranges.length ? 'ready' : 'plain'
      this.apply(ranges)
    }, delay)
  }
  destroy() { this.disposed = true; this.generation++; clearTimeout(this.timer); this.intersection.disconnect(); this.stopTheme() }
}
