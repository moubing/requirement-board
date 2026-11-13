import { savePreferenceCookie } from '../utils/preference-cookie'

export type AppTheme = 'light' | 'dark' | 'system'

function normalizeTheme(value: unknown): AppTheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function useAppTheme() {
  const cookie = useCookie<AppTheme>('rb-theme', {
    default: () => 'system',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
    watch: false,
  })
  const theme = useState<AppTheme>('app-theme', () => normalizeTheme(cookie.value))
  const saveError = useState('app-theme-save-error', () => '')
  function save() {
    saveError.value = savePreferenceCookie('rb-theme', theme.value)
    if (!saveError.value) cookie.value = theme.value
  }

  function setTheme(value: AppTheme) {
    theme.value = normalizeTheme(value)
    save()
  }

  return { theme: readonly(theme), setTheme, saveError: readonly(saveError), retrySave: save }
}
