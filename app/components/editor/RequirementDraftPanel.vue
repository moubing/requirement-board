<script setup lang="ts">
import { computed } from 'vue'
import { BingButton } from '@moubing/bing-ui'
import type { useRequirementDraft } from '../../composables/use-requirement-draft'
import type { useRequirementCollaboration } from '../../composables/use-requirement-collaboration'

const props = defineProps<{
  draft: ReturnType<typeof useRequirementDraft> | ReturnType<typeof useRequirementCollaboration>
  disabled?: boolean
  stacked?: boolean
}>()
const working = computed(() => props.disabled || props.draft.busy.value || props.draft.syncing.value)
const timestamp = computed(() => [props.draft.cloudTime.value, props.draft.localTime.value].filter(Boolean).sort().at(-1) ?? '')
const hasWarning = computed(() => Boolean(props.draft.cloudError.value || props.draft.localError.value || props.draft.recoveryError.value))
const date = (value: string) => new Date(value).toLocaleTimeString()
</script>

<template>
  <section class="draft-status" :class="{ 'draft-status--warning': hasWarning, 'draft-status--stacked': stacked }" aria-label="保存状态">
    <div class="draft-status__row">
      <p role="status" aria-live="polite" :class="{ 'draft-status__warning': draft.cloudError.value }">
        {{ draft.status.value }}<span v-if="timestamp" class="draft-status__time">{{ date(timestamp) }}</span>
        <span v-if="draft.localTime.value && !draft.localError.value" class="draft-status__checkpoint" :title="`最近个人检查点备份于 ${date(draft.localTime.value)}`">{{ draft.needsBackup.value ? '个人检查点待备份' : '个人检查点已备份' }}</span>
      </p>
      <BingButton v-if="draft.canRetry.value && (draft.cloudError.value || draft.localError.value || draft.recoveryError.value)" class="draft-status__retry" size="sm" variant="ghost" :disabled="working" @click="draft.retry">重试</BingButton>
    </div>
    <p v-if="draft.localError.value" class="draft-status__warning" role="alert">{{ draft.localError.value }}</p>
    <p v-if="draft.recoveryError.value" class="draft-status__warning" role="alert">{{ draft.recoveryError.value }}</p>
  </section>
</template>

<style scoped>
.draft-status { padding: 0; color: var(--rb-muted); }
.draft-status--warning { padding: 6px 10px; border: 1px solid rgb(var(--bing-warning-rgb) / .25); border-radius: 6px; background: var(--bing-warning-soft); }
.draft-status__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.draft-status p { margin: 0; font-size: 12px; line-height: 1.6; }
.draft-status__row > p { min-width: 0; overflow-wrap: anywhere; }
.draft-status__retry { flex-shrink: 0; }
.draft-status__time { margin-left: 10px; }
.draft-status__checkpoint { display: inline-block; margin-left: 12px; padding-left: 12px; border-left: 1px solid var(--rb-border); }
.draft-status__warning { color: var(--bing-warning-strong); }
.draft-status--stacked .draft-status__checkpoint { display: block; margin: 3px 0 0; padding: 0; border: 0; }
.draft-status--stacked .draft-status__row { align-items: flex-start; gap: 4px; }
</style>
