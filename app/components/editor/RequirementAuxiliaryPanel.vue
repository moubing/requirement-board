<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { BingButton, BingDialog, BingIcon, BingTabs, type BingTabValue } from '@moubing/bing-ui'
import { PanelRightClose } from 'lucide-vue-next'

const props = defineProps<{ compact: boolean }>()
const open = defineModel<boolean>({ required: true })
const tab = defineModel<BingTabValue>('tab', { required: true })
let closing: Promise<void> | null = null
let finishClosing: (() => void) | undefined
function onPanelUnmounted() { finishClosing?.(); finishClosing = undefined; closing = null }
function close() {
  if (closing) return closing
  if (!props.compact || !open.value) return Promise.resolve()
  closing = new Promise<void>(resolve => { finishClosing = resolve })
  open.value = false
  return closing
}
defineExpose({ close })
onBeforeUnmount(onPanelUnmounted)
const tabs = [{ value: 'outline', label: '目录' }, { value: 'properties', label: '文档信息' }, { value: 'annotations', label: 'AI 标注' }]
const containerProps = computed(() => props.compact
  ? { modelValue: open.value, width: 320, showFooter: false, showClose: false, showPeek: false, overlayBlur: false, ariaLabel: '文档辅助面板' }
  : { class: 'requirement-side', 'aria-label': '文档辅助面板', style: open.value ? undefined : 'display: none' })
</script>

<template>
  <component :is="compact ? BingDialog : 'aside'" v-bind="containerProps" @update:model-value="open = $event">
    <div class="document-panel" :class="{ 'document-panel--drawer': compact }" @vue:unmounted="onPanelUnmounted">
      <header class="document-panel__header">
        <BingTabs v-model="tab" :items="tabs" class="document-panel__tabs" variant="soft" size="sm" block ariaLabel="文档辅助面板内容" />
        <BingButton variant="ghost" size="sm" :throttle="false" aria-label="收起文档辅助面板" @click="open = false"><BingIcon :icon="PanelRightClose" :size="17" decorative /></BingButton>
      </header>
      <div class="document-panel__body" role="tabpanel" :aria-label="tab === 'outline' ? '目录' : tab === 'annotations' ? 'AI 标注' : '文档信息'">
        <slot />
      </div>
    </div>
  </component>
</template>
