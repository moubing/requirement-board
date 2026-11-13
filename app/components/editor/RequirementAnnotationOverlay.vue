<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { BingButton } from '@moubing/bing-ui'
import { gsap } from 'gsap'
import { resolveAnnotation, type AiAnnotation } from '~~/shared/agent/annotations'
import { isInsideClosedDetails, revealDetailsAncestors } from './details-visibility'
import { annotationRanges, objectAnnotationElement } from './annotation-capture'
import RequirementAnnotationComposer, { type AnnotationComposerAnchor } from './RequirementAnnotationComposer.vue'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'

const props = defineProps<{
  editor: Editor; annotations: AiAnnotation[]; activeId?: string; active: boolean
  draft?: AiAnnotation | null; comment?: string; error?: string
  versionGutter?: boolean
  getScrollController: () => { viewport: HTMLElement | null; stop: () => void } | null
}>()
const emit = defineEmits<{ select: [id: string]; 'update:comment': [value: string]; save: []; cancel: [] }>()
const root = ref<HTMLElement>()
const marks = ref<{ id: string; left: number; top: number; width: number; height: number; object: boolean }[]>([])
const pins = ref<{ id: string; number: number; quote: string; left: number; top: number; size: number; multiline: boolean }[]>([])
const anchor = ref<AnnotationComposerAnchor | null>(null)
const flashingId = ref('')
const editing = computed(() => props.annotations.some(note => note.id === props.draft?.id))
const visibleNotes = computed(() => props.draft && !editing.value ? [...props.annotations, props.draft] : props.annotations)
let frame = 0
let observer: ResizeObserver | undefined
let disposed = false
let reduceMotion = false
let motionPreference: ReturnType<typeof gsap.matchMedia> | undefined
let scrollTween: gsap.core.Tween | undefined
let flashTween: gsap.core.Animation | undefined
let swingingPin: HTMLElement | undefined
let navigation = 0
let navigationId = ''
let finishScroll: ((completed: boolean) => void) | undefined

function clearFlash() {
  flashTween?.kill()
  flashTween = undefined
  if (swingingPin) gsap.set(swingingPin, { clearProps: 'transform,transformOrigin' })
  swingingPin = undefined
  flashingId.value = ''
  root.value?.style.removeProperty('--annotation-flash-opacity')
}
function cancelNavigation() {
  navigation++
  navigationId = ''
  scrollTween?.kill()
  scrollTween = undefined
  finishScroll?.(false)
  finishScroll = undefined
  clearFlash()
}
function flash(id: string) {
  clearFlash()
  if (!props.active || !root.value || !pins.value.some(pin => pin.id === id)) return
  flashingId.value = id
  if (reduceMotion) {
    root.value.style.setProperty('--annotation-flash-opacity', '1')
    flashTween = gsap.delayedCall(.8, clearFlash)
  } else {
    swingingPin = Array.from(root.value.querySelectorAll<HTMLElement>('.annotation-overlay__pin-anchor')).find(element => element.dataset.annotationId === id)
    const timeline = gsap.timeline({ onComplete: clearFlash })
      .fromTo(root.value, { '--annotation-flash-opacity': 0 }, { '--annotation-flash-opacity': 1, duration: .16, ease: 'power2.out' })
      .to(root.value, { '--annotation-flash-opacity': 0, duration: .6, ease: 'power2.inOut' })
    flashTween = timeline
    if (swingingPin) {
      // 支点放在编号下方，让按钮沿圆弧摆动；外层负责动效，保留 BingButton 自身的交互样式。
      const swing = gsap.timeline({ defaults: { ease: 'sine.inOut' } })
        .set(swingingPin, { transformOrigin: '50% 70px' })
        .to(swingingPin, { rotation: -14, duration: .11 })
        .to(swingingPin, { rotation: 12, duration: .18 })
        .to(swingingPin, { rotation: -8, duration: .16 })
        .to(swingingPin, { rotation: 5, duration: .14 })
        .to(swingingPin, { rotation: -2, duration: .12 })
        .to(swingingPin, { rotation: 0, duration: .12 })
      timeline.add(swing, 0)
    }
  }
}

function noteRects(note: AiAnnotation, document = props.editor.getJSON()) {
  const resolved = resolveAnnotation(note, document)
  if (resolved.status === 'unresolved') return []
  const surface = props.editor.view.dom
  if (resolved.target) {
    const element = objectAnnotationElement(props.editor, resolved.target)
    if (!element || isInsideClosedDetails(element)) return []
    const rect = element.getBoundingClientRect()
    let { left, top, right, bottom } = rect
    let parent = element.parentElement
    while (parent && surface.contains(parent)) {
      if (parent.matches('.requirement-node-scroll__viewport')) {
        const clip = parent.getBoundingClientRect()
        left = Math.max(left, clip.left); right = Math.min(right, clip.right)
        top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom)
      }
      parent = parent.parentElement
    }
    return right > left && bottom > top ? [{ left, top, right, bottom, width: right - left, height: bottom - top }] : []
  }
  return annotationRanges(props.editor, resolved.segments).flatMap(range => {
    const container = range.commonAncestorContainer
    if (isInsideClosedDetails(container instanceof Element ? container : container.parentElement)) return []
    const viewport = (container instanceof Element ? container : container.parentElement)?.closest('.bing-scrollbar__viewport')
    const clip = viewport && surface.contains(viewport) ? viewport.getBoundingClientRect() : null
    return Array.from(range.getClientRects()).map(rect => {
      const left = clip ? Math.max(rect.left, clip.left) : rect.left
      const top = clip ? Math.max(rect.top, clip.top) : rect.top
      const right = clip ? Math.min(rect.right, clip.right) : rect.right
      const bottom = clip ? Math.min(rect.bottom, clip.bottom) : rect.bottom
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    })
  }).filter(rect => rect.width > 0 && rect.height > 0)
}

function selectionBounds(rects: ReturnType<typeof noteRects>) {
  const first = rects[0], end = rects.at(-1)
  if (!first || !end) return null
  return {
    first, end,
    left: Math.min(...rects.map(rect => rect.left)),
    top: Math.min(...rects.map(rect => rect.top)),
    bottom: Math.max(...rects.map(rect => rect.bottom)),
    // 同行的加粗、链接等也会产生多个 rect，不能据此误判成多行。
    multiline: rects.some(rect => rect.top >= first.bottom - 1 || rect.bottom <= first.top + 1),
  }
}

function overlapsText(left: number, top: number, size: number, cache: Map<Element, DOMRect[]>) {
  const surface = props.editor.view.dom
  // 只检查编号覆盖的小片区域，不逐帧扫描整篇文档。穿透浮层寻找下面的正文块。
  const points: [number, number][] = [[left + 1, top + 1], [left + size - 1, top + 1], [left + size / 2, top + size / 2], [left + 1, top + size - 1], [left + size - 1, top + size - 1]]
  for (const [x, y] of points) {
    const element = document.elementsFromPoint(x, y).find(element => surface.contains(element))
    const block = element?.closest('p, h1, h2, h3, h4, h5, h6, pre')
    if (!block || !surface.contains(block)) continue
    let rects = cache.get(block)
    if (!rects) {
      const range = document.createRange()
      range.selectNodeContents(block)
      rects = Array.from(range.getClientRects())
      cache.set(block, rects)
    }
    if (rects.some(rect => rect.width && rect.height && rect.right > left && rect.left < left + size && rect.bottom > top && rect.top < top + size)) return true
  }
  return false
}

function measure() {
  cancelAnimationFrame(frame)
  frame = 0
  anchor.value = null
  if (!props.active || !visibleNotes.value.length || !root.value || props.editor.isDestroyed) { marks.value = []; pins.value = []; return }
  const origin = root.value.getBoundingClientRect()
  const viewport = props.getScrollController()?.viewport?.getBoundingClientRect()
  const size = 28
  const nextMarks: typeof marks.value = [], nextPins: typeof pins.value = []
  const document = props.editor.getJSON()
  const surface = props.editor.view.dom
  const surfaceBounds = surface.getBoundingClientRect()
  const surfaceStyle = getComputedStyle(surface)
  const paddingLeft = parseFloat(surfaceStyle.paddingLeft)
  const paddingRight = parseFloat(surfaceStyle.paddingRight)
  const textRects = new Map<Element, DOMRect[]>()
  const versionRects = props.versionGutter
    ? Array.from(root.value.parentElement?.querySelectorAll<HTMLElement>('[data-version-marker]') ?? []).map(element => element.getBoundingClientRect()) : []
  visibleNotes.value.forEach((note, index) => {
    const rects = noteRects(note, document)
    const object = Boolean(note.target && note.target.type !== 'text')
    for (const rect of rects) nextMarks.push({ id: note.id, left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height, object })
    const bounds = selectionBounds(rects)
    if (!bounds) return
    const { end } = bounds
    const multiline = bounds.multiline || object
    // 多行编号沿正文左侧留白排列；窄屏夹在浮层边界内，再通过候选位置避让文字。
    const gutterLeft = multiline
      ? Math.max(4, surfaceBounds.left - origin.left + paddingLeft - size - (props.versionGutter ? 22 : 4))
      : Math.min(origin.width - size - 4, surfaceBounds.right - origin.left - paddingRight + 4)
    const pin = { id: note.id, number: index + 1, quote: note.quote, size, multiline,
      left: Math.max(4, Math.min(end.right - origin.left - size / 2, origin.width - size - 4)),
      top: Math.max(0, end.top - origin.top - size - 3) }
    if (multiline) { pin.left = gutterLeft; pin.top = Math.max(0, bounds.top - origin.top - size - 3) }
    const start = multiline ? bounds.first : end
    const lineTop = start.top - origin.top + (start.height - size) / 2
    const candidates = [
      { left: pin.left, top: pin.top },
      ...(props.versionGutter ? [{ left: origin.width - size - 4, top: pin.top }] : []),
      ...(!multiline ? [
        { left: end.right - origin.left + 4, top: lineTop },
        ...[1, -1, 2, -2].map(offset => ({ left: pin.left + offset * (size + 4), top: pin.top })),
      ] : []),
      { left: gutterLeft, top: lineTop },
      ...Array.from({ length: visibleNotes.value.length }, (_, offset) => ({ left: gutterLeft, top: lineTop + (offset + 1) * (size + 4) })),
    ]
    for (const candidate of candidates) {
      if (candidate.left < 4 || candidate.left + size > origin.width - 4 || candidate.top < 0 || candidate.top + size > origin.height) continue
      if (nextPins.some(other => Math.abs(other.left - candidate.left) < size + 3 && Math.abs(other.top - candidate.top) < size + 3)) continue
      if (overlapsText(origin.left + candidate.left, origin.top + candidate.top, size, textRects)) continue
      if (versionRects.some(rect => rect.left < origin.left + candidate.left + size && rect.right > origin.left + candidate.left
        && rect.top < origin.top + candidate.top + size && rect.bottom > origin.top + candidate.top)) continue
      Object.assign(pin, candidate)
      break
    }
    nextPins.push(pin)
    if (note.id === props.draft?.id && viewport && start.bottom > viewport.top && start.top < viewport.bottom) {
      anchor.value = { left: multiline ? bounds.left : origin.left + pin.left + size / 2,
        top: multiline ? bounds.top : origin.top + pin.top, bottom: bounds.bottom, align: multiline ? 'start' : 'center',
        viewport: { left: Math.max(0, viewport.left), right: Math.min(window.innerWidth, viewport.right), top: Math.max(0, viewport.top), bottom: Math.min(window.innerHeight, viewport.bottom) } }
    }
  })
  marks.value = nextMarks
  pins.value = nextPins
}
function schedule() { if (!disposed && props.active && !frame) frame = requestAnimationFrame(measure) }

async function scrollTo(id: string, emphasize = true) {
  cancelNavigation()
  const request = navigation
  navigationId = id
  const [, { ScrollToPlugin }] = await Promise.all([nextTick(), import('gsap/ScrollToPlugin')])
  if (disposed || !props.active || props.editor.isDestroyed || request !== navigation) return false
  gsap.registerPlugin(ScrollToPlugin)
  const note = visibleNotes.value.find(note => note.id === id)
  if (note) {
    const resolved = resolveAnnotation(note, props.editor.getJSON())
    if (resolved.status !== 'unresolved') {
      if (resolved.target) revealDetailsAncestors(objectAnnotationElement(props.editor, resolved.target), true)
      else annotationRanges(props.editor, resolved.segments).forEach(range => revealDetailsAncestors(range.commonAncestorContainer))
    }
  }
  if (note?.target && note.target.type !== 'text' && resolveAnnotation(note, props.editor.getJSON()).status !== 'unresolved') {
    const element = objectAnnotationElement(props.editor, note.target)
    let parent = element?.parentElement
    while (element && parent && props.editor.view.dom.contains(parent)) {
      if (parent.matches('.requirement-node-scroll__viewport')) {
        const rect = element.getBoundingClientRect(), clip = parent.getBoundingClientRect()
        const delta = rect.left < clip.left + 12 ? rect.left - clip.left - 12 : rect.right > clip.right - 12 ? Math.min(rect.right - clip.right + 12, rect.left - clip.left - 12) : 0
        parent.scrollTo({ left: parent.scrollLeft + delta, behavior: 'instant' })
      }
      parent = parent.parentElement
    }
  }
  const controller = props.getScrollController()
  const viewport = controller?.viewport
  const bounds = note && selectionBounds(noteRects(note))
  const rect = bounds && (bounds.multiline || (note?.target && note.target.type !== 'text') ? bounds.first : bounds.end)
  if (!rect || !controller || !viewport?.isConnected) { navigationId = ''; return false }
  controller.stop()
  const top = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight,
    viewport.scrollTop + rect.top - viewport.getBoundingClientRect().top - Math.min(220, viewport.clientHeight * .4)))
  const complete = () => { navigationId = ''; scrollTween = undefined; measure(); if (emphasize) flash(id) }
  if (reduceMotion || Math.abs(top - viewport.scrollTop) < 1) {
    viewport.scrollTo({ top, behavior: 'instant' })
    complete()
    return true
  }
  return new Promise<boolean>(resolve => {
    finishScroll = resolve
    scrollTween = gsap.to(viewport, {
      scrollTo: { y: top, autoKill: true, onAutoKill: cancelNavigation },
      duration: Math.min(.6, Math.max(.28, Math.abs(top - viewport.scrollTop) / 1600)),
      ease: 'power2.inOut', overwrite: 'auto', onUpdate: schedule,
      onComplete: () => { finishScroll = undefined; complete(); resolve(true) },
      onInterrupt: () => { finishScroll?.(false); finishScroll = undefined },
    })
  })
}

defineExpose({ scrollTo })
watch(() => props.versionGutter, schedule, { flush: 'post' })
watch(() => [props.annotations, props.draft], () => {
  if ((navigationId && !visibleNotes.value.some(note => note.id === navigationId)) || (flashingId.value && !props.annotations.some(note => note.id === flashingId.value))) cancelNavigation()
  schedule()
}, { deep: true })
watch(() => props.draft?.id, async id => {
  if (!id) return
  await nextTick()
  if (!props.active || props.editor.isDestroyed || props.draft?.id !== id) return
  props.getScrollController()?.stop()
  const bounds = selectionBounds(noteRects(props.draft))
  const viewport = props.getScrollController()?.viewport?.getBoundingClientRect()
  // 拖选跨过一屏后，把多行选区的起点带回视口，为上方输入框留出位置。
  if (bounds && (bounds.multiline || props.draft?.target?.type !== 'text') && viewport && (bounds.top < viewport.top + 180 || bounds.top > viewport.bottom)) void scrollTo(id, false)
})
watch(() => props.active, active => {
  if (active) schedule()
  else { cancelNavigation(); cancelAnimationFrame(frame); frame = 0; marks.value = []; pins.value = []; anchor.value = null }
})
function onTransaction({ transaction }: { transaction: Transaction }) {
  if (transaction.docChanged) cancelNavigation()
  schedule()
}
function onUserInput(event: Event) {
  const viewport = props.getScrollController()?.viewport
  if (navigationId && event.target instanceof Node && viewport?.contains(event.target)) {
    if (!(event instanceof KeyboardEvent) || ['Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelNavigation()
  }
}
useActiveVisualEffect(() => props.active, () => {
  motionPreference = gsap.matchMedia()
  motionPreference.add({ reduce: '(prefers-reduced-motion: reduce)', normal: '(prefers-reduced-motion: no-preference)' }, context => {
    reduceMotion = Boolean(context.conditions?.reduce)
    if (reduceMotion && scrollTween) scrollTween.progress(1)
    clearFlash()
  })
  props.editor.on('transaction', onTransaction)
  window.addEventListener('resize', schedule)
  document.addEventListener('scroll', schedule, true)
  document.addEventListener('wheel', onUserInput, { capture: true, passive: true })
  document.addEventListener('pointerdown', onUserInput, true)
  document.addEventListener('keydown', onUserInput, true)
  props.editor.view.dom.addEventListener('requirement-editor-layout-motion-frame', schedule)
  observer = new ResizeObserver(schedule)
  observer.observe(props.editor.view.dom)
  // 正文达到最大宽度后，收起侧栏只改变居中偏移，仍需跟随外层宽度测量。
  if (root.value) observer.observe(root.value)
  document.fonts?.ready.then(() => { if (!disposed) schedule() })
  schedule()
  return () => {
    cancelNavigation()
    motionPreference?.revert()
    cancelAnimationFrame(frame); frame = 0
    observer?.disconnect()
    props.editor.off('transaction', onTransaction)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('scroll', schedule, true)
    document.removeEventListener('wheel', onUserInput, true)
    document.removeEventListener('pointerdown', onUserInput, true)
    document.removeEventListener('keydown', onUserInput, true)
    if (!props.editor.isDestroyed) props.editor.view.dom.removeEventListener('requirement-editor-layout-motion-frame', schedule)
  }
})
onBeforeUnmount(() => {
  disposed = true
  cancelNavigation()
  motionPreference?.revert()
  cancelAnimationFrame(frame)
  observer?.disconnect()
  props.editor.off('transaction', onTransaction)
  window.removeEventListener('resize', schedule)
  document.removeEventListener('scroll', schedule, true)
  document.removeEventListener('wheel', onUserInput, true)
  document.removeEventListener('pointerdown', onUserInput, true)
  document.removeEventListener('keydown', onUserInput, true)
  if (!props.editor.isDestroyed) props.editor.view.dom.removeEventListener('requirement-editor-layout-motion-frame', schedule)
})
</script>

<template>
  <div ref="root" class="annotation-overlay">
    <span v-for="(mark, index) in marks" :key="index" class="annotation-overlay__highlight" :class="{ 'is-object': mark.object, 'is-active': mark.id === activeId || mark.id === draft?.id, 'is-flashing': mark.id === flashingId }" :data-annotation-id="mark.id" aria-hidden="true"
      :style="{ left: `${mark.left}px`, top: `${mark.top}px`, width: `${mark.width}px`, height: `${mark.height}px` }" />
    <span v-for="pin in pins" :key="pin.id" class="annotation-overlay__pin-anchor" :data-annotation-id="pin.id"
      :style="{ left: `${pin.left}px`, top: `${pin.top}px`, width: `${pin.size}px`, height: `${pin.size}px` }">
      <BingButton size="xs" rounded="md" :variant="pin.id === activeId || pin.id === draft?.id ? 'primary' : 'secondary'" text-effect="none" :throttle="false"
        class="annotation-overlay__pin" :class="{ 'is-active': pin.id === activeId || pin.id === draft?.id, 'is-flashing': pin.id === flashingId }" :data-annotation-id="pin.id" :data-multiline="pin.multiline"
        :aria-label="`查看 AI 标注 ${pin.number}`" :title="pin.quote" @pointerdown.stop @click.stop="emit('select', pin.id)">
        {{ pin.number }}
      </BingButton>
    </span>
  </div>
  <RequirementAnnotationComposer v-if="active && draft" :key="draft.id" :anchor="anchor" :editing="editing" :model-value="comment ?? ''" :error="error"
    @update:model-value="emit('update:comment', $event)" @save="emit('save')" @cancel="emit('cancel')" />
</template>

<style scoped>
.annotation-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2; user-select: none; }
.annotation-overlay__highlight { position: absolute; background: color-mix(in srgb, var(--ui-accent) 13%, transparent); box-shadow: inset 0 -1px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.annotation-overlay__highlight.is-active { background: color-mix(in srgb, var(--ui-accent) 23%, transparent); }
.annotation-overlay__highlight.is-object { background: transparent; box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ui-accent) 65%, transparent); border-radius: 2px; }
.annotation-overlay__highlight.is-object.is-active { box-shadow: inset 0 0 0 2px var(--ui-accent); }
.annotation-overlay__pin-anchor { position: absolute; }
.annotation-overlay .annotation-overlay__pin { pointer-events: auto; width: 100%; height: 100%; min-width: 0; padding: 0; }
.annotation-overlay__highlight.is-flashing::after { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--ui-accent) 32%, transparent); opacity: var(--annotation-flash-opacity, 0); pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .annotation-overlay__pin-anchor { transform: none !important; } }
</style>
