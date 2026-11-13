<script setup lang="ts">
import { computed } from 'vue'
import { BingSelect, type BingSelectModelValue } from '@moubing/bing-ui'
import type { BoardUser } from '~/types/requirement-board'
const props = defineProps<{ modelValue: string[]; users: BoardUser[]; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]]; change: [] }>()
const options = computed(() => props.users.map(user => ({ value: user.id, label: user.name })))
const selectedUsers = computed(() => props.users.filter(user => props.modelValue.includes(user.id)))
const selectedNames = computed(() => selectedUsers.value.map(user => user.name).join('、'))
const selected = computed<BingSelectModelValue>({ get: () => props.modelValue,
  set: value => emit('update:modelValue', Array.isArray(value) ? value.map(String) : []) })
</script>
<template>
  <BingSelect v-model="selected" :options="options" multiple :disabled="disabled" :show-select-all="false" :clearable="!compact" :min-width="compact ? 0 : undefined" :width="compact ? 184 : undefined" block
    placeholder="选择负责人（可多选）" aria-label="负责人" @change="emit('change')">
    <template v-if="compact" #value>
      <span class="document-assignees__summary" :title="selectedNames || '未分配负责人'">
        <span v-if="selectedUsers[0]" class="document-assignees__avatar" :style="{ '--assignee-color': selectedUsers[0].avatarColor }" aria-hidden="true">{{ Array.from(selectedUsers[0].name.trim())[0]?.toLocaleUpperCase() || '?' }}</span>
        <span class="document-assignees__names">{{ selectedNames || '未分配' }}</span>
      </span>
    </template>
  </BingSelect>
</template>

<style scoped>
.document-assignees__summary { display: flex; align-items: center; gap: 8px; min-width: 0; }
.document-assignees__avatar { display: grid; place-items: center; flex: 0 0 22px; height: 22px; border-radius: 50%; color: var(--assignee-color, var(--bing-accent-strong)); background: color-mix(in srgb, var(--assignee-color, var(--bing-accent-strong)) 12%, var(--bing-surface-solid)); font-size: 12px; }
.document-assignees__names { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
