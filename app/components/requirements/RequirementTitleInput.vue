<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BingButton, BingInput } from '@moubing/bing-ui'
import { draftError } from '#shared/drafts/document'

const props = defineProps<{ title: string; disabled?: boolean; save: (title: string) => Promise<string> }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const input = ref(props.title)
const pending = ref(false)
const error = ref('')
const dirty = computed(() => input.value !== props.title)
let request: Promise<boolean> | undefined
watch(() => props.title, (next, previous) => {
  // 其他成员改名时保留本机尚未提交的输入。
  if (input.value === previous) input.value = next
})

function validate() {
  if (!input.value.trim()) { error.value = '文档标题不能为空'; return false }
  if (input.value.trim().length > 240) { error.value = '标题最多 240 个字符'; return false }
  return true
}
function commit(forVersion = false): Promise<boolean> {
  if (request) return request
  if (!dirty.value) return Promise.resolve(true)
  if (props.disabled && !forVersion) return Promise.resolve(false)
  const title = input.value.trim()
  if (!validate()) return Promise.resolve(false)
  if (title === props.title) { input.value = title; return Promise.resolve(true) }
  pending.value = true; emit('busy', true); error.value = ''
  request = props.save(title).then(saved => { input.value = saved; return true }).catch(cause => {
    error.value = `${draftError(cause)}，标题尚未保存。`
    return false
  }).finally(() => { pending.value = false; emit('busy', false); request = undefined })
  return request
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape' && !pending.value) { input.value = props.title; error.value = '' }
}
function enter(_value: string | number | null, event: KeyboardEvent) {
  event.preventDefault()
  void commit()
}
defineExpose({ commit, validate })
</script>

<template>
  <div>
    <BingInput :model-value="input" class="requirement-document-title" aria-label="文档名称" placeholder="输入文档名称"
      :maxlength="240" block :disabled="disabled || pending" :status="error ? 'error' : 'default'"
      @update:model-value="input = String($event ?? ''); error = ''" @blur="!error && commit()" @enter="enter" @keydown="keydown" />
    <div v-if="error" class="requirement-title-feedback" role="alert">
      <span>{{ error }}</span><BingButton size="sm" :throttle="false" :disabled="disabled || pending" @click="commit()">重试保存标题</BingButton>
      <BingButton size="sm" :throttle="false" :disabled="pending" @click="input = title; error = ''">取消修改</BingButton>
    </div>
  </div>
</template>

<style scoped>
.requirement-title-feedback { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--rb-text-muted); }
[role='alert'] { color: var(--bing-danger-strong); }
</style>
