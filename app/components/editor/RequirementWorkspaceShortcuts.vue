<script setup lang="ts">
import { Bell, LockKeyhole } from 'lucide-vue-next'
import { BingButton, BingIcon } from '@moubing/bing-ui'

defineProps<{ noticeCount: number; locked: boolean; feedbackOpen: boolean; agentOpen: boolean; compact?: boolean }>()
defineEmits<{ feedback: []; agent: [] }>()
</script>

<template>
  <div class="requirement-workspace-shortcuts">
    <BingButton size="sm" variant="ghost" :disabled="!noticeCount" :aria-expanded="feedbackOpen" aria-label="打开工作区提示" :title="`${noticeCount} 条工作区提示`" @click="$emit('feedback')">
      <template #prefix><BingIcon :icon="Bell" :size="16" decorative /></template><span v-if="!compact">提示 · {{ noticeCount }}</span>
    </BingButton>
    <BingButton v-if="locked" size="sm" variant="ghost" :aria-expanded="agentOpen" aria-label="打开 AI 编辑状态" @click="$emit('agent')">
      <template #prefix><BingIcon :icon="LockKeyhole" :size="16" decorative /></template><span v-if="!compact">AI 编辑中</span>
    </BingButton>
  </div>
</template>

<style scoped>
.requirement-workspace-shortcuts { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
</style>
