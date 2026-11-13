<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { ExternalLink, LinkIcon, Trash2 } from 'lucide-vue-next'
import { BingButton, BingDropDown, BingIcon, BingInput, BingTooltip } from '@moubing/bing-ui'

import { normalizeLinkHref } from '~~/shared/editor/link'

const props = withDefaults(
  defineProps<{
    open?: boolean
    href?: string
    selectedText?: string
    hasSelection?: boolean
    active?: boolean
    disabled?: boolean
    surface?: 'toolbar' | 'selection'
  }>(),
  {
    open: false,
    href: '',
    selectedText: '',
    hasSelection: false,
    active: false,
    disabled: false,
    surface: 'toolbar',
  },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  apply: [value: { href: string; text?: string }]
  remove: []
}>()

const textInputRef = ref<{ focus: () => void } | null>(null)
const hrefInputRef = ref<{ focus: () => void; select: () => void } | null>(null)
const messageId = useId()
const draftText = ref('')
const draftHref = ref('')
const errorMessage = ref('')
const selectionPreview = ref('')

const buttonClass = computed(() =>
  props.surface === 'selection' ? 'requirement-editor__selection-tool' : 'requirement-editor__tool',
)
const activeButtonClass = computed(() =>
  props.surface === 'selection'
    ? 'requirement-editor__selection-tool--active'
    : 'requirement-editor__tool--active',
)
const tooltipPlacement = computed(() => (props.surface === 'selection' ? 'top' : 'bottom'))
const panelPlacement = computed(() => (props.surface === 'selection' ? 'top-start' : 'bottom-start'))
const panelTitle = computed(() => (props.active ? '编辑链接' : '设置链接'))
const needsDisplayText = computed(() => !props.active && !props.hasSelection)

function updateOpen(open: boolean) {
  emit('update:open', open)
}

async function preparePanel() {
  draftHref.value = props.href
  draftText.value = ''
  errorMessage.value = ''
  selectionPreview.value = props.selectedText.trim().replace(/\s+/g, ' ')
  await nextTick()
  if (needsDisplayText.value) {
    textInputRef.value?.focus()
    return
  }

  hrefInputRef.value?.focus()
  if (props.href) hrefInputRef.value?.select()
}

function applyLink() {
  const text = draftText.value.trim()
  if (needsDisplayText.value && !text) {
    errorMessage.value = '请输入链接文字'
    return
  }

  const result = normalizeLinkHref(draftHref.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }

  errorMessage.value = ''
  emit('apply', { href: result.href, text: needsDisplayText.value ? text : undefined })
  updateOpen(false)
}

function removeLink() {
  emit('remove')
  updateOpen(false)
}

function openCurrentLink() {
  if (!props.href || typeof window === 'undefined') return
  window.open(props.href, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <BingDropDown
    :open="open"
    trigger="click"
    :placement="panelPlacement"
    size="sm"
    :width="336"
    :min-width="336"
    :max-width="336"
    :auto-focus="false"
    :typeahead="false"
    panel-class="requirement-editor__link-panel-shell"
    aria-label="链接设置"
    @update:open="updateOpen"
    @open="preparePanel"
  >
    <template #trigger="{ open: panelOpen, triggerProps }">
      <BingTooltip content="链接" :placement="tooltipPlacement">
        <BingButton
          v-bind="triggerProps"
          :class="[buttonClass, { [activeButtonClass]: active || panelOpen }]"
          size="sm"
          variant="ghost"
          rounded="sm"
          :disabled="disabled"
          :aria-label="panelOpen ? '关闭链接设置' : active ? '编辑链接' : '设置链接'"
          @mousedown.prevent
        >
          <template #prefix>
            <BingIcon :icon="LinkIcon" :size="surface === 'selection' ? 15 : 16" decorative />
          </template>
        </BingButton>
      </BingTooltip>
    </template>

    <form class="requirement-editor__link-panel" @submit.prevent="applyLink">
      <header class="requirement-editor__link-panel-header">
        <span class="requirement-editor__link-panel-icon" aria-hidden="true">
          <BingIcon :icon="LinkIcon" :size="15" decorative />
        </span>
        <span>
          <strong>{{ panelTitle }}</strong>
          <small v-if="selectionPreview" :title="selectionPreview">{{ selectionPreview }}</small>
          <small v-else-if="href" :title="href">{{ href }}</small>
          <small v-else>在当前光标位置插入新链接</small>
        </span>
      </header>

      <label v-if="needsDisplayText" class="requirement-editor__link-field">
        <span>显示文字</span>
        <BingInput
          ref="textInputRef"
          v-model="draftText"
          type="text"
          size="sm"
          block
          clearable
          :status="errorMessage === '请输入链接文字' ? 'error' : 'default'"
          placeholder="例如：查看接口文档"
          autocomplete="off"
          spellcheck
          aria-label="链接显示文字"
          @input="errorMessage = ''"
          @keydown.enter.prevent="hrefInputRef?.focus()"
        />
      </label>

      <label class="requirement-editor__link-field">
        <span>链接地址</span>
        <BingInput
          ref="hrefInputRef"
          v-model="draftHref"
          type="text"
          size="sm"
          block
          clearable
          :status="errorMessage ? 'error' : 'default'"
          placeholder="https://example.com"
          autocomplete="off"
          :spellcheck="false"
          aria-label="链接地址"
          :aria-describedby="messageId"
          @input="errorMessage = ''"
          @keydown.enter.prevent="applyLink"
        />
      </label>

      <p v-if="errorMessage" :id="messageId" class="requirement-editor__link-message is-error" role="alert">
        {{ errorMessage }}
      </p>
      <p v-else :id="messageId" class="requirement-editor__link-message">
        支持网址、邮箱、电话和站内路径
      </p>

      <footer class="requirement-editor__link-actions">
        <span class="requirement-editor__link-actions-secondary">
          <BingButton v-if="active && href" size="sm" variant="ghost" html-type="button" @click="openCurrentLink">
            <template #prefix>
              <BingIcon :icon="ExternalLink" :size="14" decorative />
            </template>
            打开
          </BingButton>
          <BingButton
            v-if="active"
            class="requirement-editor__link-remove"
            size="sm"
            variant="ghost"
            html-type="button"
            @click="removeLink"
          >
            <template #prefix>
              <BingIcon :icon="Trash2" :size="14" decorative />
            </template>
            移除
          </BingButton>
        </span>

        <span class="requirement-editor__link-actions-primary">
          <BingButton size="sm" variant="ghost" html-type="button" @click="updateOpen(false)">取消</BingButton>
          <BingButton size="sm" variant="primary" html-type="submit">{{ active ? '更新' : '应用' }}</BingButton>
        </span>
      </footer>
    </form>
  </BingDropDown>
</template>
