<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BingButton, BingIcon, BingInput, BingSelect, bingToast, normalizeCodeLanguage, type BingSelectModelValue } from '@moubing/bing-ui'
import { Copy } from 'lucide-vue-next'
import { codeLanguageLabel, codeLanguageOptions } from './code-highlight'
import { CODE_BLOCK_TITLE_MAX_LENGTH, normalizeCodeBlockTitle } from '~~/shared/editor/code-block'

const props = defineProps<{ language?: string | null; title?: string | null; text: string; editable?: boolean }>()
const emit = defineEmits<{ language: [value: string]; title: [value: string] }>()
const value = computed(() => normalizeCodeLanguage(props.language))
const options = computed(() => codeLanguageOptions.some(option => option.value === value.value) ? codeLanguageOptions
  : [...codeLanguageOptions, { value: value.value, label: `${value.value}（不支持高亮）`, disabled: true }])
const copying = ref(false)
const draftTitle = ref(props.title ?? '')
let titleDirty = false
watch(() => props.title, value => { if (!titleDirty) draftTitle.value = value ?? '' })
watch(() => props.editable, value => { if (!value) cancelTitle() })
function changeTitle(value: string | number | null) { draftTitle.value = String(value ?? ''); titleDirty = true }
function confirmTitle() {
  const changed = titleDirty
  titleDirty = false
  draftTitle.value = changed ? normalizeCodeBlockTitle(draftTitle.value) ?? '' : props.title ?? ''
  if (changed && props.editable) emit('title', draftTitle.value)
}
function cancelTitle() { titleDirty = false; draftTitle.value = props.title ?? '' }
function titleEnter(_value: string | number | null, event: KeyboardEvent) {
  event.preventDefault(); event.stopPropagation()
  confirmTitle()
  ;(event.target as HTMLInputElement).blur()
}
function titleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    cancelTitle()
    const input = event.target as HTMLInputElement
    input.blur()
  }
}
function changeLanguage(next: BingSelectModelValue) { if (typeof next === 'string' && props.editable) emit('language', next) }
async function copyCode() {
  if (copying.value) return
  copying.value = true
  try {
    if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持写入剪贴板')
    await navigator.clipboard.writeText(props.text)
    bingToast.success({ message: '代码已复制', position: 'top-center' })
  } catch (error) {
    const reason = error instanceof DOMException && error.name === 'NotAllowedError' ? '剪贴板权限被拒绝，请允许访问后重试'
      : error instanceof Error ? error.message : '剪贴板写入失败，请重试'
    bingToast.error({ message: `复制代码失败：${reason}`, position: 'top-center', duration: 6500 })
  } finally { copying.value = false }
}
</script>

<template>
  <div class="requirement-code-block__header" contenteditable="false">
    <BingSelect v-if="editable" :model-value="value" :options="options" searchable :clearable="false" size="sm"
      :width="160" :min-width="0" search-placeholder="搜索语言" aria-label="代码语言"
      @update:model-value="changeLanguage" />
    <span v-else class="requirement-code-block__language">{{ codeLanguageLabel(language) }}</span>
    <BingInput v-if="editable" class="requirement-code-block__name-input" :model-value="draftTitle" size="sm" block
      placeholder="代码块名称（可选）" aria-label="代码块名称" :maxlength="CODE_BLOCK_TITLE_MAX_LENGTH" :spellcheck="false"
      @update:model-value="changeTitle" @blur="confirmTitle" @enter="titleEnter" @keydown="titleKeydown" />
    <span v-else-if="title" class="requirement-code-block__name" :title="title">{{ title }}</span>
    <BingButton class="requirement-code-block__copy" variant="ghost" size="sm" :throttle="false" :disabled="copying" aria-label="复制代码" title="复制代码"
      @mousedown.prevent @click="copyCode"><BingIcon :icon="Copy" :size="16" decorative /></BingButton>
  </div>
</template>
