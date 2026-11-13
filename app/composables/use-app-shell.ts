import { computed, ref } from 'vue'

export function useAppShell() {
  const preference = useCookie<boolean>('rb-sidebar-open', { default: () => true, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const desktopOpen = computed({ get: () => typeof preference.value === 'boolean' ? preference.value : true, set: value => { preference.value = value } })
  // 移动抽屉是临时状态，跨断点时清理，不覆盖桌面偏好。
  const mobile = ref(false)
  const mobileOpen = ref(false)
  return { desktopOpen, mobile, mobileOpen }
}
