<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { BingButton } from '@moubing/bing-ui'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import { cancelEditorGeometry, scheduleEditorGeometry } from './editor-geometry'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'
import { caretChapterHeading, chapterHeadingSelector, copyChapterLink, findChapterHeading } from './chapter-link'

const props = withDefaults(defineProps<{
  requirementId: string
  editor?: Editor
  surface?: HTMLElement | null
  active?: boolean
  inline?: boolean
  getViewport?: () => HTMLElement | null | undefined
}>(), { active: true })
const root = ref<HTMLElement>()
const surface = computed(() => props.editor?.view.dom ?? props.surface)
const hovered = shallowRef<HTMLElement | null>(null)
const caret = shallowRef<HTMLElement | null>(null)
const focused = shallowRef<HTMLElement | null>(null)
const heading = computed(() => focused.value ?? hovered.value ?? caret.value)
const button = ref<{ left: number; top: number; id: string } | null>(null)
const emphasis = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const highlighted = shallowRef<HTMLElement | null>(null)
const highlightSequence = ref(0)
const owner = {}
let timer: ReturnType<typeof setTimeout> | undefined

function measure() {
  if (!root.value || !surface.value || !props.active) return
  if (highlighted.value && !highlighted.value.isConnected) {
    highlighted.value = findChapterHeading(surface.value, highlighted.value.dataset.diffId ?? '')
  }
  if (!heading.value && !highlighted.value) return () => { button.value = null; emphasis.value = null }
  const origin = root.value.getBoundingClientRect()
  const viewport = props.getViewport?.()?.getBoundingClientRect() ?? { left: 0, right: innerWidth, top: 0, bottom: innerHeight }
  const target = heading.value
  let nextButton: typeof button.value = null
  if (target?.isConnected) {
    const rect = target.getBoundingClientRect()
    if (rect.bottom > viewport.top && rect.top < viewport.bottom && rect.width) {
      const range = document.createRange()
      range.selectNodeContents(target)
      const lines = Array.from(range.getClientRects()).filter(line => line.width && line.height)
      const first = lines[0] ?? rect, last = lines.at(-1) ?? rect
      const size = 20
      const pins = Array.from(root.value.parentElement?.querySelectorAll('.annotation-overlay__pin-anchor') ?? []).map(pin => pin.getBoundingClientRect())
      const fits = (left: number, top: number) => left >= viewport.left + 2 && left + size <= viewport.right - 2
        && !pins.some(pin => left < pin.right + 3 && left + size > pin.left - 3 && top < pin.bottom + 3 && top + size > pin.top - 3)
      let left = rect.left - 40, top = first.top + (first.height - size) / 2
      // # 在版本标记外侧；空间不足或 AI 编号占位时退到文字末尾。
      if (props.inline || innerWidth <= 700 || !fits(left, top)) {
        const gutter = !props.inline && innerWidth > 700 ? [
          ...pins.map(pin => ({ left, top: pin.bottom + 4 })),
          { left: left - 40, top },
        ].find(point => point.top >= rect.top && point.top + size <= rect.bottom && fits(point.left, point.top)) : undefined
        if (gutter) { left = gutter.left; top = gutter.top }
        else {
          left = last.right + 4
          top = last.top + (last.height - size) / 2
          if (!fits(left, top)) { left = Math.min(rect.right - size, viewport.right - size - 2); top = last.bottom + 2 }
          while (!fits(left, top) && top < viewport.bottom) top += size + 4
        }
      }
      if (top >= viewport.top && top + size <= viewport.bottom) nextButton = { id: target.dataset.diffId!, left: left - origin.left, top: top - origin.top }
    }
  }
  const flash = highlighted.value?.isConnected ? highlighted.value.getBoundingClientRect() : null
  const nextEmphasis = flash?.width ? { left: flash.left - origin.left, top: flash.top - origin.top, width: flash.width, height: flash.height } : null
  return () => {
    button.value = nextButton; emphasis.value = nextEmphasis
    // 从强调区域实际挂载的这一帧计时，避免首屏排版耗时吃掉提示时间。
    if (nextEmphasis && !timer) timer = setTimeout(() => { highlighted.value = null; timer = undefined; schedule() }, 900)
  }
}
function schedule() { if (surface.value && props.active) scheduleEditorGeometry(surface.value, owner, measure) }
function refreshCaret() {
  caret.value = props.editor?.isFocused ? caretChapterHeading(props.editor) : null
  if (focused.value && !focused.value.isConnected) focused.value = null
  if (hovered.value && !hovered.value.isConnected) hovered.value = null
  schedule()
}
function refreshAfterFocus() {
  queueMicrotask(() => {
    if (!root.value?.contains(document.activeElement)) focused.value = null
    refreshCaret()
  })
}
function focusButton(event: FocusEvent) {
  const id = (event.target as HTMLElement).dataset.chapterId
  focused.value = heading.value?.dataset.diffId === id ? heading.value : surface.value && id ? findChapterHeading(surface.value, id) : null
}
function move(event: PointerEvent) {
  if (!(event.target instanceof Element) || root.value?.contains(event.target)) return
  const next = event.target.closest<HTMLElement>(chapterHeadingSelector)
  if (next && surface.value?.contains(next)) hovered.value = next
  else if (hovered.value) {
    const rect = hovered.value.getBoundingClientRect()
    // 保留标题到页边按钮之间的通道，不移动光标即可点击。
    if (event.clientY < rect.top || event.clientY > rect.bottom || event.clientX < rect.left - 72 || event.clientX > rect.right + 24) hovered.value = null
  }
  schedule()
}
function leave() { hovered.value = null; schedule() }
function highlight(id: string) {
  clearTimeout(timer)
  timer = undefined
  highlighted.value = surface.value ? findChapterHeading(surface.value, id) : null
  emphasis.value = null
  highlightSequence.value++
  schedule()
}
defineExpose({ highlight })

useActiveVisualEffect(() => props.active && Boolean(surface.value && root.value), () => {
  const content = surface.value!, area = root.value!.parentElement!
  const observer = new ResizeObserver(schedule)
  observer.observe(content)
  const mutations = new MutationObserver(refreshCaret)
  mutations.observe(content, { subtree: true, childList: true, characterData: true })
  const pins = area.querySelector('.annotation-overlay')
  if (pins) mutations.observe(pins, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
  area.addEventListener('pointermove', move)
  area.addEventListener('pointerleave', leave)
  content.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, schedule)
  document.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  props.editor?.on('selectionUpdate', refreshCaret).on('focus', refreshCaret).on('blur', refreshAfterFocus)
  refreshCaret()
  return () => {
    clearTimeout(timer)
    timer = undefined
    observer.disconnect(); mutations.disconnect()
    area.removeEventListener('pointermove', move); area.removeEventListener('pointerleave', leave)
    content.removeEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, schedule)
    document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
    props.editor?.off('selectionUpdate', refreshCaret).off('focus', refreshCaret).off('blur', refreshAfterFocus)
    cancelEditorGeometry(content, owner)
    hovered.value = null; caret.value = null; focused.value = null; highlighted.value = null; button.value = null; emphasis.value = null
  }
})
watch(heading, schedule)
</script>

<template>
  <div ref="root" class="chapter-links" :class="{ 'chapter-links--inline': inline }" contenteditable="false" @contextmenu.stop>
    <span v-if="emphasis" :key="highlightSequence" class="chapter-links__emphasis" aria-hidden="true"
      :style="{ left: `${emphasis.left}px`, top: `${emphasis.top}px`, width: `${emphasis.width}px`, height: `${emphasis.height}px` }" />
    <BingButton v-if="button" class="chapter-links__copy" variant="ghost" size="xs" aria-label="复制章节链接" title="复制章节链接"
      :data-chapter-id="button.id" :style="{ left: `${button.left}px`, top: `${button.top}px` }"
      @mousedown.prevent @focus="focusButton" @blur="refreshAfterFocus" @click.stop="copyChapterLink(requirementId, button.id)">#</BingButton>
  </div>
</template>

<style scoped>
.chapter-links { position: absolute; inset: 0; pointer-events: none; z-index: 1; user-select: none; }
.chapter-links--inline { z-index: 3; }
.chapter-links .chapter-links__copy { position: absolute; pointer-events: auto; width: 20px; min-width: 20px; height: 20px; min-height: 20px; padding: 0; font-size: 17px; line-height: 20px; color: var(--bing-muted); }
.chapter-links .chapter-links__copy:hover, .chapter-links .chapter-links__copy:focus-visible { color: var(--ui-accent); }
.chapter-links__emphasis { position: absolute; border-radius: 4px; background: color-mix(in srgb, var(--ui-accent) 16%, transparent); animation: chapter-emphasis 900ms ease-out; }
@keyframes chapter-emphasis { from { opacity: 0; } 20%, 55% { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .chapter-links__emphasis { animation: none; } }
</style>
