<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BingButton, BingDialog, BingSelect, type BingSelectModelValue } from '@moubing/bing-ui'
import type { RequirementPropertyPatch } from '#shared/requirements/properties'
import type { BoardUser } from '~/types/requirement-board'
import { draftError } from '#shared/drafts/document'
import DocumentAssignees from '../documents/DocumentAssignees.vue'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  statusId: string; statusName: string; assigneeIds: string[]; priority: 'low' | 'medium' | 'high'
  users: BoardUser[]; statusOptions: { statusId: string; statusName: string }[]
  disabled: boolean; save: (patch: RequirementPropertyPatch) => Promise<void>
}>()
const selectedStatus = ref('')
const owners = ref<string[]>([])
const priority = ref<BingSelectModelValue>('medium')
const busy = ref(false)
const error = ref('')
let initial: RequirementPropertyPatch = {}
watch(open, value => {
  if (!value) return
  if (error.value || busy.value) return
  initial = { statusId: props.statusId, assigneeIds: [...props.assigneeIds], priority: props.priority }
  selectedStatus.value = props.statusId; owners.value = [...props.assigneeIds]; priority.value = props.priority; error.value = ''
})
const statusOptions = computed(() => [
  ...(props.statusOptions.some(item => item.statusId === props.statusId) ? [] : [{ value: props.statusId, label: props.statusName }]),
  ...props.statusOptions.map(item => ({ value: item.statusId, label: item.statusId === props.statusId ? `${item.statusName}（当前）` : item.statusName })),
])
async function confirm() {
  if (busy.value || props.disabled) return
  const patch: RequirementPropertyPatch = {}
  if (selectedStatus.value !== initial.statusId) patch.statusId = selectedStatus.value
  if (JSON.stringify([...owners.value].sort()) !== JSON.stringify([...(initial.assigneeIds ?? [])].sort())) patch.assigneeIds = [...owners.value]
  if (priority.value !== initial.priority && ['low', 'medium', 'high'].includes(String(priority.value))) patch.priority = priority.value as 'low' | 'medium' | 'high'
  if (!Object.keys(patch).length) { error.value = '属性没有变化，无需保存。'; return }
  busy.value = true; error.value = ''
  open.value = false
  try { await props.save(patch) }
  catch (cause) { error.value = `${draftError(cause)}，选择尚未保存，可重试。` }
  finally { busy.value = false }
}
</script>

<template>
  <BingDialog :busy="busy" v-model="open" title="文档属性" :width="480" :show-peek="false">
    <div class="side-form">
      <label><span>状态</span><BingSelect v-model="selectedStatus" :options="statusOptions" :disabled="disabled || busy" :clearable="false" :searchable="false" block aria-label="文档状态" /></label>
      <label><span>负责人（可多选）</span><DocumentAssignees v-model="owners" :users="users" :disabled="disabled || busy" /></label>
      <label><span>优先级</span><BingSelect v-model="priority" :options="[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]" :disabled="disabled || busy" :clearable="false" :searchable="false" block aria-label="优先级" /></label>
      <p class="requirement-meta-status">确认后保存这些属性，不生成正文版本。</p>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    </div>
    <template #footer><BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton><BingButton :loading="busy" :disabled="disabled" @click="confirm">确认保存属性</BingButton></template>
  </BingDialog>
</template>
