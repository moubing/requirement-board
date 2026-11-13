import { editorFontFamily, editorFontKinds, normalizeEditorFont, type EditorFontKind } from './editor-fonts'

export const editorTextKinds = ['h1', 'h2', 'h3', 'paragraph'] as const
export type EditorTextKind = typeof editorTextKinds[number]
export type EditorColorTheme = 'light' | 'dark'

export const preferenceLimits = {
  fontSize: { min: 12, max: 72 },
  paragraphSize: { min: 12, max: 32 },
  lineHeight: { min: 1.2, max: 2.4 },
  documentWidth: { min: 640, max: 1800 },
  panelWidth: { min: 320, max: 560 },
}

export interface EditorTextPreference {
  fontSize: number | null
  colors: Record<EditorColorTheme, string | null>
}

export interface AppPreferences {
  version: 1
  customCursor: boolean
  editor: {
    fonts: Record<EditorFontKind, string | null>
    text: Record<EditorTextKind, EditorTextPreference>
    lineHeight: number | null
    documentWidth: number
    panelWidth: number
    versionMarkers: boolean
  }
}

export function defaultAppPreferences(): AppPreferences {
  return {
    version: 1,
    customCursor: false,
    editor: {
      fonts: { body: null, code: null },
      text: {
        h1: { fontSize: null, colors: { light: null, dark: null } },
        h2: { fontSize: null, colors: { light: null, dark: null } },
        h3: { fontSize: null, colors: { light: null, dark: null } },
        paragraph: { fontSize: null, colors: { light: null, dark: null } },
      },
      lineHeight: null,
      documentWidth: 880,
      panelWidth: 360,
      versionMarkers: true,
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function bounded(value: unknown, limits: { min: number; max: number }, fallback: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)) * 100) / 100
}

function color(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value.toLowerCase() : null
}

// Cookie 是不可信输入；只接受已知字段，CSS 值不能直接来自持久化字符串。
export function normalizeAppPreferences(value: unknown): AppPreferences {
  const result = defaultAppPreferences()
  const input = record(value)
  if (input.version !== 1) return result
  if (typeof input.customCursor === 'boolean') result.customCursor = input.customCursor
  const editor = record(input.editor)
  const fonts = record(editor.fonts)
  for (const kind of editorFontKinds) result.editor.fonts[kind] = normalizeEditorFont(fonts[kind])
  const text = record(editor.text)
  for (const kind of editorTextKinds) {
    const entry = record(text[kind])
    const colors = record(entry.colors)
    result.editor.text[kind] = {
      fontSize: bounded(entry.fontSize, kind === 'paragraph' ? preferenceLimits.paragraphSize : preferenceLimits.fontSize, null),
      colors: { light: color(colors.light), dark: color(colors.dark) },
    }
  }
  result.editor.lineHeight = bounded(editor.lineHeight, preferenceLimits.lineHeight, null)
  result.editor.documentWidth = bounded(editor.documentWidth, preferenceLimits.documentWidth, 880)!
  result.editor.panelWidth = bounded(editor.panelWidth, preferenceLimits.panelWidth, 360)!
  if (typeof editor.versionMarkers === 'boolean') result.editor.versionMarkers = editor.versionMarkers
  return result
}

export function appPreferenceHtmlAttrs(preferences: AppPreferences) {
  const styles: string[] = [`--rb-editor-width:${preferences.editor.documentWidth}px`]
  for (const kind of editorFontKinds) {
    const family = normalizeEditorFont(preferences.editor.fonts[kind])
    if (family) styles.push(`--rb-editor-font-${kind}:${editorFontFamily(family)}`)
  }
  const sizes: string[] = []
  const colors: string[] = []
  for (const kind of editorTextKinds) {
    const entry = preferences.editor.text[kind]
    if (entry.fontSize !== null) {
      sizes.push(kind)
      styles.push(`--rb-editor-${kind}-size:${entry.fontSize}px`)
    }
    if (entry.colors.light || entry.colors.dark) {
      colors.push(kind)
      // 无自定义颜色的一侧继续跟随主题，避免亮色偏好覆盖暗色的可读默认值。
      const fallback = kind === 'paragraph' ? 'var(--rb-ink)' : 'var(--rb-navy)'
      styles.push(`--rb-editor-${kind}-color:light-dark(${entry.colors.light ?? fallback},${entry.colors.dark ?? fallback})`)
    }
  }
  if (preferences.editor.lineHeight !== null) styles.push(`--rb-editor-line-height:${preferences.editor.lineHeight}`)
  return {
    style: styles.join(';'), 'data-editor-sizes': sizes.join(' '), 'data-editor-colors': colors.join(' '),
    'data-editor-line-height': preferences.editor.lineHeight !== null ? '' : undefined,
  }
}
