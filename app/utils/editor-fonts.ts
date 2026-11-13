export const editorFontKinds = ['body', 'code'] as const
export type EditorFontKind = typeof editorFontKinds[number]
export const defaultEditorFont = 'Maple Mono NF CN'
export const editorFontSample = '阅读与编辑 Aa Bb 0123'

// 字体名来自 Cookie、手动输入或本机枚举；整串校验，不能清洗后拼接 CSS。
export function normalizeEditorFont(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !/^[\p{Script=Han}a-zA-Z0-9 ._-]+$/u.test(value)) return null
  return value.trim() || null
}

export function editorFontFamily(value: unknown): string {
  const family = normalizeEditorFont(value)
  return family ? `"${family}",var(--font-main)` : 'var(--font-main)'
}

export const editorFontPresets: Record<EditorFontKind, { label: string; family: string }[]> = {
  body: [
    { label: '微软雅黑', family: 'Microsoft YaHei' },
    { label: '苹方', family: 'PingFang SC' },
    { label: '思源黑体', family: 'Source Han Sans SC' },
    { label: 'Noto Sans SC', family: 'Noto Sans SC' },
    { label: 'HarmonyOS Sans SC', family: 'HarmonyOS Sans SC' },
    { label: '霞鹜文楷', family: 'LXGW WenKai' },
    { label: '宋体', family: 'SimSun' },
  ],
  code: ['Cascadia Code', 'JetBrains Mono', 'Consolas', 'SF Mono', 'Fira Code'].map(family => ({ label: family, family })),
}

/** 用多组后备字体的实际字宽识别字体命中；不存在的字体会在每组退回相同宽度。 */
export function createFontDetector(document: Document): (family: string) => boolean {
  const context = document.createElement('canvas').getContext('2d')
  const sample = `${editorFontSample} mWlIi一中文标点，。`
  const fallbacks = ['monospace', 'serif', 'sans-serif']
  const widths = fallbacks.map(fallback => {
    if (!context) return 0
    context.font = `72px ${fallback}`
    return context.measureText(sample).width
  })
  return (value) => {
    const family = normalizeEditorFont(value)
    if (!family) return false
    if (family === defaultEditorFont) return true
    if (!context) return false
    return fallbacks.some((fallback, index) => {
      context.font = `72px "${family}",${fallback}`
      return Math.abs(context.measureText(sample).width - widths[index]!) > 0.01
    })
  }
}
