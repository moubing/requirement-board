<script setup lang="ts">
import { computed } from 'vue'
import { Undo2 } from 'lucide-vue-next'
import { BingButton, BingIcon } from '@moubing/bing-ui'

import type { DiffVisualStatus } from './diff-presentation'

const props = withDefaults(
  defineProps<{
    status: DiffVisualStatus
    revertible?: boolean
    hunk?: boolean
  }>(),
  {
    revertible: false,
    hunk: false,
  },
)

const emit = defineEmits<{
  revert: []
}>()

const symbol = computed(() => {
  if (props.status === 'inserted') return '+'
  if (props.status === 'deleted') return '-'
  if (props.status === 'modified') return '~'
  return ''
})

const label = computed(() => {
  if (props.status === 'inserted') return '新增'
  if (props.status === 'deleted') return '删除'
  if (props.status === 'modified') return '修改'
  return ''
})
</script>

<template>
  <div class="rich-diff__gutter" :class="{ 'rich-diff__gutter--hunk': hunk, 'rich-diff__gutter--revertible': revertible }">
    <div v-if="symbol || revertible" class="rich-diff__control">
      <BingButton
        v-if="revertible"
        class="rich-diff__revert"
        size="sm"
        variant="ghost"
        rounded="sm"
        aria-label="回退此更改"
        title="回退此更改"
        @click="emit('revert')"
      >
        <template #prefix>
          <BingIcon :icon="Undo2" :size="15" decorative />
        </template>
      </BingButton>
      <span v-if="symbol" class="rich-diff__status" role="img" :aria-label="label">{{ symbol }}</span>
    </div>
    <slot />
  </div>
</template>
