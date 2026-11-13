<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { Files, LayoutDashboard, PanelsTopLeft, Users } from 'lucide-vue-next'
import { afterNextPaint } from '../utils/after-paint'

const access = useAccountAccessState()
const route = useRoute()
const emit = defineEmits<{ navigate: [] }>()
const links = computed(() => [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/requirements', label: '文档', icon: Files },
  { to: '/templates', label: '模板管理', icon: PanelsTopLeft },
  ...(access.value?.user.role === 'admin' || access.value?.projectRoles.includes('project_admin')
    ? [{ to: '/members', label: '成员管理', icon: Users }] : []),
])
const active = (path: string) => path === '/requirements' ? route.path.startsWith(path) : route.path === path
let cancelNavigation: (() => void) | undefined
onBeforeUnmount(() => cancelNavigation?.())
function follow(event: MouseEvent, href: string | null, navigate: (event?: MouseEvent) => unknown) {
  if (event.defaultPrevented || event.altKey || event.button > 1) return
  if (event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey) {
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  emit('navigate')
  cancelNavigation?.()
  cancelNavigation = afterNextPaint(() => { cancelNavigation = undefined; void navigate(event) })
}
</script>

<template>
  <nav class="app-nav" aria-label="主导航">
    <NuxtLink v-for="link in links" :key="link.to" v-slot="{ href, navigate }" :to="link.to" custom>
      <BingButton class="app-sidebar-control" variant="ghost" size="lg" block text-effect="none" :throttle="false" role="link" :title="link.label"
        :aria-current="active(link.to) ? 'page' : undefined" :class="{ 'is-active': active(link.to) }" @click="follow($event, href, navigate)" @auxclick="follow($event, href, navigate)">
        <span class="app-sidebar-control__content"><BingIcon :icon="link.icon" :size="18" decorative /><span>{{ link.label }}</span></span>
      </BingButton>
    </NuxtLink>
  </nav>
</template>
