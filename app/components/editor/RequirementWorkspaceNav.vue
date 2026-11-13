<script setup lang="ts">
import { ArrowLeft, FileText, GitCompare } from 'lucide-vue-next'
import { BingButton, BingIcon, BingTabs } from '@moubing/bing-ui'
import type { BingTabItem, BingTabValue } from '@moubing/bing-ui'

defineProps<{
  modelValue: BingTabValue
  requirementKey: string
  items: BingTabItem[]
  compact?: boolean
  pending?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: BingTabValue] }>()
const icons = { edit: FileText, diff: GitCompare }
</script>

<template>
  <nav class="requirement-navigation" :class="{ 'requirement-navigation--compact': compact }" aria-label="文档工作区">
    <div class="requirement-navigation__identity">
      <NuxtLink to="/requirements" class="requirement-back" aria-label="返回文档列表"><BingIcon :icon="ArrowLeft" :size="16" decorative /><span v-if="compact" class="requirement-back__label">文档</span></NuxtLink>
      <span class="requirement-navigation__key" :title="requirementKey">{{ requirementKey }}</span>
    </div>
    <BingTabs v-if="compact" :model-value="modelValue" :items="items" :inert="pending" variant="soft" size="sm" aria-label="文档视图" @update:model-value="emit('update:modelValue', $event)" />
    <div v-else class="requirement-navigation__views">
      <BingButton v-for="item in items" :key="item.value" variant="ghost" size="sm" block :disabled="item.disabled" :aria-pressed="modelValue === item.value" :class="{ 'requirement-navigation__view--active': modelValue === item.value }" @click="emit('update:modelValue', item.value)">
        <template #prefix><BingIcon :icon="icons[item.value as keyof typeof icons]" :size="15" decorative /></template>
        {{ item.label }}
      </BingButton>
    </div>
  </nav>
</template>
