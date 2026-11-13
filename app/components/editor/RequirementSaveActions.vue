<script setup lang="ts">
import { computed, ref } from 'vue'
import { CloudCheck, CloudAlert, Save } from 'lucide-vue-next'
import { BingButton, BingDialog, BingIcon } from '@moubing/bing-ui'
import type { useRequirementCollaboration } from '../../composables/use-requirement-collaboration'
import RequirementDraftPanel from './RequirementDraftPanel.vue'

const props = defineProps<{
  draft: ReturnType<typeof useRequirementCollaboration>
  label: string
  saving: boolean
  disabled: boolean
  modified: boolean | null
  compact?: boolean
  toolbar?: boolean
}>()
const emit = defineEmits<{ save: [] }>()
const detailsOpen = ref(false)
const warning = computed(() => Boolean(props.draft.cloudError.value || props.draft.localError.value || props.draft.recoveryError.value))
</script>

<template>
  <div class="requirement-save-actions" :class="{ 'requirement-save-actions--compact': compact || toolbar }">
    <BingButton v-if="toolbar" class="requirement-sync-trigger" :class="{ 'requirement-sync-warning': warning }" variant="ghost" size="sm" :throttle="false" :title="draft.status.value" aria-label="查看草稿同步和个人检查点" @click="detailsOpen = true">
      <BingIcon :icon="warning ? CloudAlert : CloudCheck" :size="17" decorative /><span class="requirement-sync-text">{{ draft.status.value }}</span>
    </BingButton>
    <BingButton size="sm" :block="!compact && !toolbar" :loading="saving" :disabled="disabled" :aria-label="label" @click="emit('save')">
      <template #prefix><BingIcon :icon="Save" :size="15" decorative /></template>{{ label }}
    </BingButton>
    <p v-if="!toolbar" class="requirement-version-status" :class="{ 'requirement-version-status--modified': modified }" role="status" aria-label="版本保存状态">{{ modified === null ? '正在核对版本…' : modified ? '已修改' : '与最新版本一致' }}</p>
    <RequirementDraftPanel v-if="!toolbar" :draft="draft" :disabled="saving" :stacked="!compact" />
    <BingDialog v-model="detailsOpen" title="草稿同步与备份" :width="420" :show-footer="false" :show-peek="false">
      <RequirementDraftPanel :draft="draft" :disabled="saving" stacked />
      <p class="requirement-version-status">正式版本：{{ modified === null ? '正在核对…' : modified ? '有尚未保存为版本的修改' : '与最新版本一致' }}</p>
    </BingDialog>
  </div>
</template>

<style scoped>
.requirement-version-status { margin: 0; color: var(--bing-muted); font-size: 12px; line-height: 1.6; }
.requirement-version-status--modified, .requirement-sync-warning { color: var(--bing-warning-strong); font-weight: 600; }
.requirement-sync-trigger { color: var(--bing-muted); }
.requirement-sync-trigger.requirement-sync-warning { color: var(--bing-warning-strong); }
.requirement-sync-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
