<script setup lang="ts">
import { BingButton, BingDropDown, BingDropDownItem, BingIcon, BingScrollbar } from '@moubing/bing-ui'
import { Clock3 } from 'lucide-vue-next'
import type { BoardRequirement } from '~/types/requirement-board'

defineProps<{ items: (BoardRequirement & { visitedAt: number })[]; currentId: string; disabled?: boolean; loading?: boolean; error?: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ select: [id: string]; clear: []; retry: [] }>()
function time(value: number) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) }
</script>

<template>
  <BingDropDown v-model:open="open" placement="bottom-end" :width="380" :max-width="'calc(100vw - 24px)'" :auto-focus="true" aria-label="最近浏览的文档">
    <template #trigger="{ triggerProps }">
      <BingButton v-bind="triggerProps" variant="ghost" size="lg" class="app-header-control"
        :throttle="false" :disabled="disabled" aria-label="最近浏览" title="最近浏览">
        <span class="app-header-button-content"><BingIcon :icon="Clock3" :size="18" decorative /><span class="recent-requirements-label app-header-action-label">最近浏览</span></span>
      </BingButton>
    </template>
    <div class="recent-requirements-heading"><strong>最近浏览</strong><span>{{ items.length }} / 20</span></div>
    <BingScrollbar :max-height="'min(360px, calc(100dvh - 240px))'" :focusable="false">
      <div v-if="error" class="recent-requirements-empty" role="alert">{{ error }}</div>
      <div v-else-if="loading && !items.length" class="recent-requirements-empty" role="status">正在加载…</div>
      <div v-else-if="!items.length" class="recent-requirements-empty">暂无最近浏览</div>
      <BingDropDownItem v-for="item in error ? [] : items" :key="item.id"
        :title="`${item.key}（${item.title}）`" :description="time(item.visitedAt)"
        :aria-label="`${item.key}（${item.title}）${item.id === currentId ? '，当前文档' : ''}`"
        :active="item.id === currentId" :disabled="disabled" :close-on-click="false" @click="emit('select', item.id)" />
    </BingScrollbar>
    <BingDropDownItem v-if="error" title="重试加载" :close-on-click="false" @click="emit('retry')" />
    <BingDropDownItem v-if="items.length" title="清空最近浏览" :close-on-click="false" @click="emit('clear')" />
  </BingDropDown>
</template>
