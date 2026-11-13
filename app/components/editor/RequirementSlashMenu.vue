<script setup lang="ts">
import { BingDropDown, BingDropDownGroup, BingDropDownItem } from '@moubing/bing-ui'
import type { Editor } from '@tiptap/core'
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import type { SlashMenuState } from './slash-command-extension'

const props = defineProps<{ editor: Editor; state: SlashMenuState | null; getViewport: () => HTMLElement | null | undefined }>()
const emit = defineEmits<{ close: []; select: [index: number]; move: [index: number] }>()
const groups = computed(() => {
  const result: { label: string; items: { item: NonNullable<typeof props.state>['items'][number]; index: number }[] }[] = []
  for (const [index, item] of (props.state?.items ?? []).entries()) {
    let group = result.at(-1)
    if (!group || group.label !== item.group) { group = { label: item.group, items: [] }; result.push(group) }
    group.items.push({ item, index })
  }
  return result
})
const anchor = shallowRef<{ getBoundingClientRect: () => DOMRect } | null>(null)
const boundary = shallowRef<HTMLElement | null>(null)
let cleanup: (() => void) | undefined

function measure() {
  const viewport = props.getViewport()
  if (!props.state || !viewport || !viewport.isConnected) { anchor.value = null; return }
  const rect = viewport.getBoundingClientRect()
  const caret = props.editor.view.coordsAtPos(props.state.range.to)
  if (caret.top < rect.top || caret.bottom > rect.bottom || caret.left < rect.left || caret.left > rect.right) { emit('close'); return }
  boundary.value = viewport
  const bounds = new DOMRect(caret.left, caret.top, Math.max(1, caret.right - caret.left), caret.bottom - caret.top)
  anchor.value = { getBoundingClientRect: () => bounds }
}

watch(() => props.state, async state => {
  cleanup?.(); cleanup = undefined
  if (!state) { anchor.value = null; return }
  await nextTick()
  if (props.state !== state) return
  measure()
  const viewport = props.getViewport()
  // 滚动正文时关闭；菜单内部滚动不影响编辑器选区。
  const close = () => emit('close')
  viewport?.addEventListener('scroll', close, { passive: true })
  window.addEventListener('resize', close)
  let initial = true
  const observer = new ResizeObserver(() => { if (initial) { initial = false; return }; close() })
  if (viewport) observer.observe(viewport)
  cleanup = () => { viewport?.removeEventListener('scroll', close); window.removeEventListener('resize', close); observer.disconnect() }
}, { flush: 'post' })
onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <!-- 虚拟锚点没有触发器；空根节点使用块布局，避免行内盒在正文上方撑出一行。 -->
  <BingDropDown block :open="Boolean(state && anchor)" :anchor="anchor" :boundary="boundary" :auto-focus="false" :typeahead="false"
    :close-on-escape="false" :width="300" :min-width="0" aria-label="插入正文块" panel-class="requirement-slash-menu"
    @update:open="value => { if (!value) emit('close') }">
    <div class="requirement-slash-menu__items" @mousedown.prevent>
      <BingDropDownGroup v-for="group in groups" :key="group.label" :label="group.label">
        <BingDropDownItem v-for="{ item, index } in group.items" :key="item.id" :title="item.title" :icon="item.icon" :active="index === state?.index"
          :data-command-index="index" :close-on-click="false" @pointermove="emit('move', index)" @click="emit('select', index)">
          <template #suffix><span class="requirement-slash-menu__alias">{{ item.alias }}</span></template>
        </BingDropDownItem>
      </BingDropDownGroup>
      <div v-if="!state?.items.length" class="requirement-slash-menu__empty" role="status">没有匹配的命令</div>
    </div>
  </BingDropDown>
</template>

<style scoped>
.requirement-slash-menu__empty { padding: 18px 12px; color: var(--ui-text-muted); font-size: 13px; }
.requirement-slash-menu__alias { color: var(--ui-text-muted); font-size: 12px; white-space: nowrap; }
</style>
