import { readonly } from 'vue'
import { defaultAppPreferences, normalizeAppPreferences, type AppPreferences, type EditorColorTheme, type EditorTextKind } from '../utils/app-preferences'
import { savePreferenceCookie } from '../utils/preference-cookie'
import type { EditorFontKind } from '../utils/editor-fonts'

export function useAppPreferences() {
  const cookie = useCookie<AppPreferences>('rb-preferences', {
    default: defaultAppPreferences,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
    watch: false,
  })
  const preferences = useState<AppPreferences>('app-preferences', () => normalizeAppPreferences(cookie.value))
  const saveError = useState('app-preferences-save-error', () => '')
  function save() {
    saveError.value = savePreferenceCookie('rb-preferences', preferences.value)
    if (!saveError.value) cookie.value = normalizeAppPreferences(preferences.value)
  }

  function update(change: (next: AppPreferences) => void) {
    const next = normalizeAppPreferences(preferences.value)
    change(next)
    preferences.value = normalizeAppPreferences(next)
    save()
  }

  return {
    preferences: readonly(preferences),
    saveError: readonly(saveError), retrySave: save,
    setCustomCursor: (enabled: boolean) => update(next => { next.customCursor = enabled }),
    setFont: (kind: EditorFontKind, family: string | null) => update(next => { next.editor.fonts[kind] = family }),
    setFontSize: (kind: EditorTextKind, size: number | null) => update(next => { next.editor.text[kind].fontSize = size }),
    setTextColor: (kind: EditorTextKind, theme: EditorColorTheme, color: string | null) => update(next => { next.editor.text[kind].colors[theme] = color }),
    setLineHeight: (height: number | null) => update(next => { next.editor.lineHeight = height }),
    setDocumentWidth: (width: number | null) => update(next => { next.editor.documentWidth = width ?? 880 }),
    setPanelWidth: (width: number | null) => update(next => { next.editor.panelWidth = width ?? 360 }),
    setVersionMarkers: (enabled: boolean) => update(next => { next.editor.versionMarkers = enabled }),
    resetAppearance: () => update(next => { next.customCursor = defaultAppPreferences().customCursor }),
    resetReading: () => update(next => { next.editor = defaultAppPreferences().editor }),
    resetPreferences() { preferences.value = defaultAppPreferences(); save() },
  }
}
