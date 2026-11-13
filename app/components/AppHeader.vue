<script setup lang="ts">
import { useRequirementCache } from '~/composables/use-requirement-cache'
import { computed, onMounted, onServerPrefetch, ref, watch } from 'vue'
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-vue-next'
import RequirementQuickSwitcher from './requirements/RequirementQuickSwitcher.vue'
import CreateRequirementDialog from './requirements/CreateRequirementDialog.vue'
import AppSettingsDialog from './settings/AppSettingsDialog.vue'
import AppUserMenu from './AppUserMenu.vue'
import { useBoardMeta } from '../composables/use-board-meta'
defineProps<{ showNavigation: boolean; navigationExpanded: boolean; mobileNavigation: boolean }>()
const emit = defineEmits<{ toggleSidebar: [] }>()
const access = useAccountAccessState()
// 常驻范围守卫；实际文档请求由列表和搜索消费者发起。
useRequirementCache()
const route = useRoute()
const brandPath = computed(() => access.value ? (access.value.canAccessProject ? '/' : '/account') : '/login')
const meta = useBoardMeta()
const creating = ref(false)
onServerPrefetch(() => meta.refresh())
onMounted(() => { void meta.refresh() })
watch(meta.scope, () => { creating.value = false; if (import.meta.client) void meta.refresh() })
</script>

<template>
  <header class="app-header">
    <a class="app-skip-link" href="#app-content">跳到主要内容</a>
    <div class="app-header__inner">
      <BingButton v-if="showNavigation" class="app-header-control app-nav-toggle" data-shell-toggle variant="ghost" size="lg" :throttle="false"
        :aria-label="navigationExpanded ? '收起导航' : '展开导航'" :title="navigationExpanded ? '收起导航' : '展开导航'"
        :aria-controls="mobileNavigation ? 'app-mobile-navigation' : 'app-sidebar'" :aria-expanded="navigationExpanded" @click="emit('toggleSidebar')">
        <BingIcon :icon="navigationExpanded ? PanelLeftClose : PanelLeftOpen" :size="20" decorative />
      </BingButton>
      <NuxtLink :to="brandPath" class="app-brand" aria-label="文档看板首页">
        <img src="/requirement-board-logo.png" width="34" height="34" alt="" draggable="false">
        <span>文档看板</span>
      </NuxtLink>
      <div class="app-header__actions">
        <RequirementQuickSwitcher v-if="showNavigation" />
        <BingButton v-if="showNavigation" class="app-header-control" variant="ghost" size="lg" :throttle="false"
          :disabled="!meta.data.value && !meta.error.value" :loading="meta.pending.value"
          :aria-label="meta.error.value ? '重新加载新建选项' : '新建文档'" :title="meta.error.value || '新建文档'" @click="meta.error.value ? meta.refresh(true) : creating = true">
          <span class="app-header-button-content"><BingIcon :icon="Plus" :size="18" decorative /><span class="app-header-action-label">新建文档</span></span>
        </BingButton>
        <AppSettingsDialog />
        <AppUserMenu v-if="access" />
        <NuxtLink v-else-if="route.path !== '/login'" to="/login" class="app-header__login">登录</NuxtLink>
      </div>
    </div>
  </header>
  <CreateRequirementDialog v-if="showNavigation && meta.data.value" :key="meta.scope.value" v-model="creating" :meta="meta.data.value" />
</template>
