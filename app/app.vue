<script setup lang="ts">
import { BingCursor, BingToast, bingToast } from '@moubing/bing-ui'
import AppShell from './components/AppShell.vue'
import { appPreferenceHtmlAttrs } from './utils/app-preferences'

const { theme } = useAppTheme()
const { preferences } = useAppPreferences()
const access = useAccountAccessState()
const session = useAuthSessionState()
const router = useRouter()
// currentRoute 只在导航确认后更新；与 RouterView 同一轮提交身份和缓存边界。
// 初始 SSR 也从已通过中间件校验的路由取得身份，不等待客户端挂载。
watch(router.currentRoute, (route) => {
  if (route.meta.accountAccess === undefined) return
  access.value = route.meta.accountAccess
  session.value = access.value ? { user: access.value.user } : null
}, { immediate: true, flush: 'sync' })
const operationAccountEpoch = useState('operation-account-epoch', () => 0)
watch(() => access.value?.user.id, () => {
  operationAccountEpoch.value++
  if (import.meta.client) bingToast.clear()
}, { flush: 'sync' })
const detailCacheEpoch = useState('requirement-detail-cache-epoch', () => 0)
// 账号或访问资格变化时销毁整个缓存边界，防止复用旧账号的正文与草稿状态。
const pageCacheScope = computed(() => JSON.stringify([
  access.value?.user.id, access.value?.user.role, access.value?.canAccessProject,
  [...(access.value?.projectRoles ?? [])].sort(), 'project_main', detailCacheEpoch.value,
]))
useHead(() => ({ htmlAttrs: { ...appPreferenceHtmlAttrs(preferences.value), 'data-bing-theme': theme.value, lang: 'zh-CN' } }))
</script>

<template>
  <AppShell>
    <AppPageScrollbar>
      <NuxtPage :key="pageCacheScope" :keepalive="{ include: ['RequirementDetailPage'], max: 2 }" />
    </AppPageScrollbar>
  </AppShell>
  <BingToast />
  <BingCursor global :disabled="!preferences.customCursor" color="#000000" outline-color="#ffffff" />
</template>
