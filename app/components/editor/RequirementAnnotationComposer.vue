<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { BingButton, BingCard, BingDialog, BingIcon, BingTextarea, type BingTextareaExpose } from '@moubing/bing-ui'
import { Check, X } from 'lucide-vue-next'
import { gsap } from 'gsap'

export interface AnnotationComposerAnchor {
  left: number
  top: number
  bottom: number
  align: 'start' | 'center'
  viewport: { left: number; right: number; top: number; bottom: number }
}
const props = defineProps<{ anchor: AnnotationComposerAnchor | null; editing: boolean; error?: string }>()
const comment = defineModel<string>({ required: true })
const emit = defineEmits<{ save: []; cancel: [] }>()
const root = ref<HTMLElement>()
const input = ref<BingTextareaExpose>()
const height = ref(56)
const lastAnchor = ref<AnnotationComposerAnchor | null>(props.anchor)
const reminder = ref(false)
const reduceMotion = ref(false)
const hintId = `annotation-composer-hint-${useId()}`
let feedback: gsap.core.Animation | undefined
let motionPreference: ReturnType<typeof gsap.matchMedia> | undefined
let focused = false

const position = computed(() => {
  const anchor = props.anchor ?? lastAnchor.value
  if (!anchor) return { visibility: 'hidden', width: '360px', left: '0px', top: '0px' }
  const { left, top, bottom, viewport, align } = anchor
  const width = Math.min(360, viewport.right - viewport.left - 16)
  const above = top - height.value - 10
  return {
    visibility: 'visible',
    width: `${width}px`,
    left: `${Math.max(viewport.left + 8, Math.min(align === 'start' ? left : left - width / 2, viewport.right - width - 8))}px`,
    top: `${Math.max(viewport.top + 8, Math.min(above >= viewport.top + 8 ? above : bottom + 10, viewport.bottom - height.value - 8))}px`,
  }
})
function focusInput() { input.value?.textarea?.focus({ preventScroll: true }) }
function clearFeedback() {
  feedback?.kill()
  feedback = undefined
  reminder.value = false
  if (root.value) gsap.set(root.value, { clearProps: 'transform,transformOrigin' })
}
function syncMotionPreference(reduced: boolean) {
  if (reduceMotion.value === reduced) return
  reduceMotion.value = reduced
  clearFeedback()
}
function remind() {
  syncMotionPreference(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  focusInput()
  // 连续滚轮事件只播放一轮，避免每一帧重启而停在摆动起点。
  if (!root.value || feedback?.isActive()) return
  reminder.value = true
  if (reduceMotion.value) feedback = gsap.delayedCall(.8, clearFeedback)
  else feedback = gsap.timeline({ defaults: { ease: 'sine.inOut' }, onComplete: clearFeedback })
    .set(root.value, { transformOrigin: '50% 50%' })
    .to(root.value, { rotation: -2, duration: .09 })
    .to(root.value, { rotation: 1.6, duration: .14 })
    .to(root.value, { rotation: -1.1, duration: .13 })
    .to(root.value, { rotation: .6, duration: .12 })
    .to(root.value, { rotation: 0, duration: .12 })
}
function inside(event: Event) { return event.target instanceof Node && Boolean(root.value?.contains(event.target)) }
function block(event: Event) { event.preventDefault(); event.stopImmediatePropagation() }
function guardPointer(event: Event) {
  if (inside(event)) return
  block(event)
  remind()
}
function guardScroll(event: Event) {
  // 面板内滚动交给 BingTextarea / BingDialog；到达边界或操作滚动条也不属于外部干扰。
  // Dialog 已负责阻止边界滚轮继续滚动背景，无需在这里重复判断剩余滚动距离。
  if (inside(event)) return
  block(event)
  remind()
}
function guardFocus(event: FocusEvent) {
  if (inside(event) || !root.value) return
  event.stopImmediatePropagation()
  focusInput()
}
function onKeydown(event: KeyboardEvent) {
  // 在控件处理后隔离页面快捷键；提交与组词确认交给 BingTextarea。
  event.stopImmediatePropagation()
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); emit('cancel'); return }
  if (!inside(event)) { block(event); remind(); return }
  if (['Control', 'Meta', 'Shift', 'Alt', 'AltGraph'].includes(event.key)) return
  if (event.key === 'Tab') {
    // Dialog 已处理首尾循环时，不再根据新焦点重复前进一次。
    if (event.defaultPrevented) return
    event.preventDefault()
    const controls = Array.from(root.value?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') ?? [])
    const index = controls.indexOf(document.activeElement as HTMLElement)
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus({ preventScroll: true })
    return
  }
  if (event.target !== input.value?.textarea && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
    block(event); remind(); return
  }
  if ((event.ctrlKey || event.metaKey) && !['a', 'c', 'v', 'x', 'z', 'y', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'backspace', 'delete', 'enter'].includes(event.key.toLowerCase())) {
    block(event); remind(); return
  }
}
async function updateHeight() {
  await nextTick()
  // offsetHeight 不含旋转后的包围盒，晃动不影响浮层锚点。
  if (root.value) height.value = root.value.offsetHeight
}
watch(() => props.anchor, async anchor => {
  if (!anchor || focused) return
  await nextTick()
  if (input.value?.textarea && props.anchor) {
    input.value.textarea.focus({ preventScroll: true })
    focused = true
  }
}, { immediate: true })
watch(() => props.anchor, anchor => { if (anchor) lastAnchor.value = anchor })
watch(root, element => {
  if (!element) return
  void updateHeight()
  if (props.anchor) { focusInput(); focused = true }
})
watch(() => props.error, updateHeight)
watch([root, position], ([element, value]) => {
  // Dialog 的 Teleport 拥有独立根节点，将业务锚点变量限定在本实例面板。
  const panel = element?.closest<HTMLElement>('.bing-dialog')
  if (panel) for (const [key, coordinate] of Object.entries(value)) panel.style.setProperty(`--annotation-composer-${key}`, coordinate)
}, { flush: 'post' })
const pointerEvents = ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const
onMounted(() => {
  motionPreference = gsap.matchMedia()
  motionPreference.add({ reduce: '(prefers-reduced-motion: reduce)', normal: '(prefers-reduced-motion: no-preference)' }, context => {
    syncMotionPreference(Boolean(context.conditions?.reduce))
  })
  pointerEvents.forEach(type => window.addEventListener(type, guardPointer, true))
  window.addEventListener('wheel', guardScroll, { capture: true, passive: false })
  window.addEventListener('touchmove', guardScroll, { capture: true, passive: false })
  window.addEventListener('focusin', guardFocus, true)
})
onBeforeUnmount(() => {
  pointerEvents.forEach(type => window.removeEventListener(type, guardPointer, true))
  window.removeEventListener('wheel', guardScroll, true)
  window.removeEventListener('touchmove', guardScroll, true)
  window.removeEventListener('focusin', guardFocus, true)
  clearFeedback()
  motionPreference?.revert()
})
</script>

<template>
  <BingDialog :model-value="true" :width="position.width" :aria-label="editing ? '编辑 AI 标注' : '添加 AI 标注'" :aria-describedby="hintId"
    :reject-feedback="false" :show-close="false" :show-footer="false" :show-peek="false" :overlay-blur="false" :smooth-scroll="false" :close-on-overlay="false" :close-on-esc="false">
    <form ref="root" class="annotation-composer" :class="{ 'is-reminding': reminder }" @keydown="onKeydown" @submit.prevent="comment.trim() && emit('save')">
      <BingCard variant="plain" padding="none" rounded="sm" entrance="none" flip-trigger="none" :glass="false" :interactive="false" :tilt="false" :glare="false">
        <div class="annotation-composer__row">
          <BingTextarea ref="input" v-model="comment" class="annotation-composer__input" size="sm" aria-label="标注修改要求"
            :aria-describedby="hintId" :status="reminder && reduceMotion ? 'warning' : 'default'"
            placeholder="添加修改要求…" :rows="1" :autosize="{ minRows: 1, maxRows: 4 }" :autosize-transition="false" resize="none" :max-length="2000" :clearable="false" submit-on="enter" block
            @submit="comment.trim() && emit('save')" @resize="updateHeight" />
          <BingButton class="annotation-composer__action" variant="ghost" size="sm" :throttle="false" aria-label="取消标注" title="取消（Esc）" @click="emit('cancel')"><template #prefix><BingIcon :icon="X" :size="16" decorative /></template></BingButton>
          <BingButton class="annotation-composer__action" size="sm" :throttle="false" aria-label="保存标注" title="保存（Enter），Shift+Enter 换行" :disabled="!comment.trim()" @click="emit('save')"><template #prefix><BingIcon :icon="Check" :size="16" decorative /></template></BingButton>
        </div>
        <p v-if="error" class="annotation-composer__error" role="alert">{{ error }}</p>
      </BingCard>
      <span :id="hintId" class="annotation-composer__sr-only">先保存或取消标注，再操作页面。Enter 保存，Shift+Enter 换行，Esc 取消。</span>
      <span class="annotation-composer__sr-only" role="status">{{ reminder ? '请先保存或取消当前标注。' : '' }}</span>
    </form>
  </BingDialog>
</template>

<style scoped>
.annotation-composer { box-sizing: border-box; margin: 0; }
.annotation-composer__row { display: flex; align-items: center; gap: 4px; padding: 8px; }
.annotation-composer__input { flex: 1; min-width: 0; }
.annotation-composer__action { flex: 0 0 32px; width: 32px; padding: 0; }
.annotation-composer__error { padding: 0 8px 8px; font-size: 12px; line-height: 1.5; color: var(--bing-danger-strong); }
.annotation-composer__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* 沿用 Dialog 的模态行为，仅把业务面板布局改为贴近原文的透明背景浮层。 */
:global(.bing-dialog-root:has(.annotation-composer)) { padding: 0; }
:global(.bing-dialog-root:has(.annotation-composer) .bing-dialog__overlay) { background: transparent; }
:global(.bing-dialog-root:has(.annotation-composer) > .bing-dialog) {
  position: fixed; left: var(--annotation-composer-left); top: var(--annotation-composer-top); width: var(--annotation-composer-width) !important;
  visibility: var(--annotation-composer-visibility, hidden); max-width: none; max-height: none; overflow: visible; border: 0; box-shadow: none;
  transform: none !important; transition: none; will-change: auto;
}
:global(.bing-dialog:has(.annotation-composer) > .bing-dialog__header),
:global(.bing-dialog:has(.annotation-composer) > .bing-dialog__surface),
:global(.bing-dialog:has(.annotation-composer) > .bing-dialog__outline) { display: none; }
:global(.bing-dialog:has(.annotation-composer) .bing-dialog__body) { padding: 0; }
:global(.bing-dialog:has(.annotation-composer) .bing-dialog__body-scroll),
:global(.bing-dialog:has(.annotation-composer) .bing-dialog__body-scroll > .bing-scrollbar__viewport) { overflow: visible; }
@media (prefers-reduced-motion: reduce) { .annotation-composer { transform: none !important; } }
</style>
