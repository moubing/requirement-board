<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { SelectionBookmark, Transaction } from '@tiptap/pm/state'
import { BingButton, BingCard, BingScrollbar, BingTooltip, type BingScrollbarExpose } from '@moubing/bing-ui'
import type { VersionMarker } from '~~/shared/diff/version-markers'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import { scrollToContent } from '../../utils/scroll-to-content'
import { cancelEditorGeometry, scheduleEditorGeometry } from './editor-geometry'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'
import { buildVersionMarkerStrokes, connectVersionMarkerGeometry, type VersionMarkerGeometry, type VersionMarkerSegment } from './version-marker-layout'
import DiffBlockRenderer from '../diff/DiffBlockRenderer.vue'

const props = defineProps<{
  editor: Editor
  markers: VersionMarker[]
  version: number
  active: boolean
  pending: boolean
  restoreDisabledReason?: string
  compareDisabled?: boolean
  readOnly?: boolean
  getScrollController: () => BingScrollbarExpose | null
}>()
const emit = defineEmits<{ restore: [marker: VersionMarker]; compare: [marker: VersionMarker]; open: [] }>()
const root = ref<HTMLElement>()
const card = ref<HTMLElement>()
const selectedId = ref('')
const highlightedId = ref('')
const hoveredId = ref('')
const focusedId = ref('')
const visible = ref(true)
const running = computed(() => props.active && visible.value)
const selected = computed(() => props.markers.find(marker => marker.id === selectedId.value))
const emphasizedId = computed(() => props.pending ? '' : hoveredId.value || focusedId.value || selectedId.value || highlightedId.value)
const statusLabels = { inserted: '新增', modified: '修改', deleted: '删除' }
const tooltipId = useId()
const rendered = shallowRef<VersionMarkerSegment[]>([])
const renderedStrokes = shallowRef<VersionMarkerGeometry[]>([])
const contentHighlight = shallowRef<{ id: string; status: VersionMarker['status']; top: number; left: number; width: number; height: number } | null>(null)
const cardPosition = shallowRef({ left: 0, top: 0, height: 360, width: 480, ready: false })
const owner = {}
let layout: VersionMarkerSegment[] | null = null
let strokes: VersionMarkerGeometry[] = []
let elements = new Map<string, HTMLElement>()
let bookmark: SelectionBookmark | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined
let navigationId = ''
let focusOnOpen = false

function label(marker: VersionMarker) {
  return `相对 v${props.version} ${statusLabels[marker.status]}了 ${marker.pairs.length} 块`
}
function collectElements() {
  elements = new Map()
  const ids = new Set(props.markers.flatMap(marker => [marker.targetId, marker.beforeId, marker.afterId]).filter(Boolean))
  props.editor.state.doc.descendants((node, pos) => {
    if (!ids.has(node.attrs.diffId)) return
    const dom = props.editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) elements.set(node.attrs.diffId, dom)
    return false
  })
}
function measure() {
  const viewport = props.getScrollController()?.viewport
  if (!running.value || !root.value || !viewport || props.editor.isDestroyed) return
  const origin = root.value.getBoundingClientRect(), clip = viewport.getBoundingClientRect()
  if (!origin.width || !clip.height) return
  if (!layout) {
    collectElements()
    const surface = props.editor.view.dom.getBoundingClientRect()
    const padding = parseFloat(getComputedStyle(props.editor.view.dom).paddingLeft) || 0
    const left = window.innerWidth <= 700 ? clip.left + 6 - origin.left : surface.left + padding - 14 - origin.left
    const rects = new Map<string, DOMRect>()
    for (const [id, element] of elements) rects.set(id, element.getBoundingClientRect())
    layout = connectVersionMarkerGeometry(props.markers.flatMap<VersionMarkerGeometry>(marker => {
      const target = marker.targetId ? rects.get(marker.targetId) : null
      if (target) return [{ marker, left, top: target.top - origin.top, height: target.height }]
      if (marker.status !== 'deleted') return []
      const before = marker.beforeId ? rects.get(marker.beforeId) : null
      const after = marker.afterId ? rects.get(marker.afterId) : null
      const top = before && after ? (before.bottom + after.top) / 2 : before?.bottom ?? after?.top ?? surface.top
      return [{ marker, left, top: top - origin.top - 4, height: 8 }]
    }))
    strokes = buildVersionMarkerStrokes(layout)
  }
  const intersects = (item: VersionMarkerGeometry) => item.top + origin.top + item.height >= clip.top && item.top + origin.top <= clip.bottom
  const next = layout.filter(intersects)
  const nextStrokes = strokes.filter(intersects)
  // 仅测当前指向的块；强调层位于正文外，不改 ProseMirror DOM、选区或撤销历史。
  const emphasized = next.find(item => item.marker.id === emphasizedId.value)?.marker
  const targetElement = emphasized?.targetId ? elements.get(emphasized.targetId) : null
  const target = targetElement?.getBoundingClientRect()
  // 分隔线仍绘制为细线，强调范围按当前普通正文行高居中展开。
  const lineHeight = targetElement?.tagName === 'HR' ? parseFloat(getComputedStyle(props.editor.view.dom).lineHeight) || 0 : 0
  const highlightHeight = target ? Math.max(8, Math.max(target.height, lineHeight) + 6) : 0
  const highlight = target && emphasized ? {
    id: emphasized.id, status: emphasized.status,
    left: target.left - origin.left - 4, top: target.top - origin.top + (target.height - highlightHeight) / 2,
    width: target.width + 8, height: highlightHeight,
  } : null
  const anchor = layout.find(item => item.marker.id === selectedId.value)
  const inView = anchor && anchor.top + origin.top + anchor.height >= clip.top && anchor.top + origin.top <= clip.bottom
  const maxHeight = Math.min(360, clip.height - 8, window.innerHeight - 16)
  const width = Math.min(480, clip.width - 12, window.innerWidth - 16)
  const height = Math.min(card.value?.getBoundingClientRect().height || maxHeight, maxHeight)
  const position = anchor ? {
    left: Math.max(clip.left + 6, Math.min(origin.left + anchor.left + 18, clip.right - width - 6)),
    top: Math.max(clip.top + 4, Math.min(origin.top + anchor.top, clip.bottom - height - 4)),
    height: maxHeight, width, ready: true,
  } : cardPosition.value
  return () => {
    rendered.value = next
    renderedStrokes.value = nextStrokes
    contentHighlight.value = highlight
    cardPosition.value = position
    if (selectedId.value && !inView) close()
    else if (focusOnOpen) {
      focusOnOpen = false
      void nextTick(() => card.value?.querySelector<HTMLButtonElement>('[aria-label="关闭版本修改预览"]')?.focus({ preventScroll: true }))
    }
  }
}
function schedule() {
  if (running.value && !props.editor.isDestroyed) scheduleEditorGeometry(props.editor.view.dom, owner, measure)
}
function invalidate() { layout = null; schedule() }
function clearPointer() { hoveredId.value = '' }
function onScroll() { clearPointer(); schedule() }
function onPointerEnter(event: PointerEvent, id: string) {
  if (event.pointerType !== 'touch') hoveredId.value = id
}
function close(restoreFocus = true) {
  const wasOpen = Boolean(selectedId.value)
  selectedId.value = ''
  cardPosition.value = { ...cardPosition.value, ready: false }
  if (restoreFocus && wasOpen && running.value && !props.editor.isDestroyed) {
    if (bookmark) {
      try {
        const selection = bookmark.resolve(props.editor.state.doc)
        if (!selection.eq(props.editor.state.selection)) props.editor.view.dispatch(props.editor.state.tr.setSelection(selection))
      } catch { /* 已删除的选区使用当前有效选区。 */ }
    }
    props.editor.view.dom.focus({ preventScroll: true })
  }
  bookmark = undefined
  focusOnOpen = false
}
async function open(marker: VersionMarker) {
  if (!running.value || props.pending) return
  bookmark = props.editor.state.selection.getBookmark()
  emit('open')
  selectedId.value = marker.id
  focusOnOpen = true
  schedule()
}
function onTransaction({ transaction }: { transaction: Transaction }) {
  if (bookmark) bookmark = bookmark.map(transaction.mapping)
}
function outside(event: PointerEvent) {
  if (!selected.value || !(event.target instanceof Node) || card.value?.contains(event.target) || root.value?.contains(event.target)) return
  // 关闭卡片的按下事件不能再由浏览器默认动作移走刚恢复的正文选区。
  event.preventDefault()
  close()
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && selected.value) { event.preventDefault(); event.stopPropagation(); close() }
}
function restore() {
  const marker = selected.value
  if (!marker || props.pending || props.restoreDisabledReason || props.readOnly) return
  close()
  emit('restore', marker)
}
function compare() {
  const marker = selected.value
  if (!marker || props.pending || props.compareDisabled) return
  close()
  emit('compare', marker)
}
function scrollTo(marker: VersionMarker) {
  navigationId = marker.id
  collectElements()
  const id = marker.targetId ?? marker.afterId ?? marker.beforeId
  const element = id ? elements.get(id) : props.editor.view.dom
  scrollToContent(props.getScrollController(), element)
  clearTimeout(flashTimer)
  highlightedId.value = marker.id
  flashTimer = setTimeout(() => { highlightedId.value = '' }, 1000)
  schedule()
}
function next() {
  const index = props.markers.findIndex(marker => marker.id === navigationId)
  const marker = props.markers[(index + 1) % props.markers.length]
  if (marker) scrollTo(marker)
}
defineExpose({ open, next, close })
watch(() => props.markers, () => {
  if (selectedId.value && !selected.value) close()
  invalidate()
}, { flush: 'post' })
watch(() => props.version, () => close())
watch(emphasizedId, schedule, { flush: 'post' })
useActiveVisualEffect(() => props.active, () => {
  const visibility = () => { visible.value = !document.hidden }
  visibility()
  document.addEventListener('visibilitychange', visibility)
  return () => document.removeEventListener('visibilitychange', visibility)
})
useActiveVisualEffect(() => running.value, () => {
  const viewport = props.getScrollController()?.viewport
  const surface = props.editor.view.dom
  const observer = new ResizeObserver(invalidate)
  observer.observe(surface)
  if (viewport) observer.observe(viewport)
  if (root.value) observer.observe(root.value)
  viewport?.addEventListener('scroll', onScroll, { passive: true })
  surface.addEventListener('load', invalidate, true)
  surface.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, invalidate)
  window.addEventListener('resize', invalidate)
  window.addEventListener('blur', clearPointer)
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', escape, true)
  props.editor.on('transaction', onTransaction)
  document.fonts?.addEventListener('loadingdone', invalidate)
  invalidate()
  return () => {
    observer.disconnect()
    viewport?.removeEventListener('scroll', onScroll)
    surface.removeEventListener('load', invalidate, true)
    surface.removeEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, invalidate)
    window.removeEventListener('resize', invalidate)
    window.removeEventListener('blur', clearPointer)
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('keydown', escape, true)
    document.fonts?.removeEventListener('loadingdone', invalidate)
    props.editor.off('transaction', onTransaction)
    cancelEditorGeometry(surface, owner)
    close(false)
    rendered.value = []; renderedStrokes.value = []; layout = null; strokes = []; elements.clear()
    hoveredId.value = ''; focusedId.value = ''; contentHighlight.value = null
    clearTimeout(flashTimer)
  }
})
onBeforeUnmount(() => clearTimeout(flashTimer))
</script>

<template>
  <div ref="root" class="version-markers" aria-label="正文版本标记">
    <Transition v-if="running" name="version-content-highlight">
      <div v-if="contentHighlight" :key="contentHighlight.id" class="version-markers__content-highlight" :class="`is-${contentHighlight.status}`"
        :data-version-highlight="contentHighlight.id" aria-hidden="true"
        :style="{ left: `${contentHighlight.left}px`, top: `${contentHighlight.top}px`, width: `${contentHighlight.width}px`, height: `${contentHighlight.height}px` }" />
    </Transition>
    <span v-for="stroke in renderedStrokes" :key="stroke.marker.id" class="version-markers__stroke" :class="`is-${stroke.marker.status}`"
      :data-version-stroke="stroke.marker.id" aria-hidden="true"
      :style="{ left: `${stroke.left}px`, top: `${stroke.top}px`, height: `${stroke.height}px` }"><i /></span>
    <span v-for="item in rendered" :key="item.marker.id" class="version-markers__anchor"
      :style="{ left: `${item.left}px`, top: `${item.top}px`, height: `${item.height}px` }">
      <BingTooltip :id="`${tooltipId}-${item.marker.id}`" class="version-markers__tooltip" :content="label(item.marker)" placement="right" :disabled="!!selectedId">
        <template #default>
          <button class="version-markers__hit" type="button" :class="[`is-${item.marker.status}`, {
            'is-highlighted': highlightedId === item.marker.id, 'is-joined-before': item.joinedBefore, 'is-joined-after': item.joinedAfter,
          }]"
            :data-version-marker="item.marker.id" :aria-label="label(item.marker)" :aria-expanded="selectedId === item.marker.id"
            aria-haspopup="dialog"
            @pointerenter="onPointerEnter($event, item.marker.id)" @pointerleave="clearPointer"
            @focus="focusedId = item.marker.id" @blur="focusedId = ''"
            :aria-disabled="pending" @pointerdown.prevent @click.stop="open(item.marker)"><i aria-hidden="true" /></button>
        </template>
      </BingTooltip>
    </span>
  </div>
  <Teleport to="body">
    <div v-if="selected && running" ref="card" class="version-change-card rich-diff--document" role="dialog" aria-label="版本修改预览"
      :style="{ left: `${cardPosition.left}px`, top: `${cardPosition.top}px`, width: `${cardPosition.width}px`, visibility: cardPosition.ready ? 'visible' : 'hidden', '--version-card-height': `${cardPosition.height}px` }"
      @contextmenu.stop @keydown.esc.stop.prevent="close()">
      <BingCard variant="plain" padding="none" :glass="false" :tilt="false" :glare="false" :interactive="false" flip-trigger="none" entrance="none">
        <div class="version-change-card__content">
          <header><strong>v{{ version }} 中的内容</strong><span>{{ statusLabels[selected.status] }}</span><BingButton size="sm" variant="ghost" aria-label="关闭版本修改预览" @click="close()">关闭</BingButton></header>
          <BingScrollbar class="version-change-card__body" :max-height="240" aria-label="此块版本差异">
            <p v-if="selected.status === 'inserted'">此块在 v{{ version }} 之后新增。</p>
            <template v-else>
              <div v-for="pair in selected.pairs" :key="pair.id" class="version-change-card__pair">
                <DiffBlockRenderer :pair="pair" side="base" />
                <template v-if="selected.status === 'modified'"><small>当前草稿</small><DiffBlockRenderer :pair="pair" side="target" /></template>
              </div>
            </template>
          </BingScrollbar>
          <p v-if="pending || restoreDisabledReason" class="version-change-card__reason" role="status">{{ pending ? '正在核对最新修改…' : restoreDisabledReason }}</p>
          <footer>
            <BingButton v-if="!readOnly" size="sm" variant="secondary" :disabled="pending || !!restoreDisabledReason" @click="restore">恢复为 v{{ version }}</BingButton>
            <BingButton size="sm" variant="ghost" :disabled="pending || compareDisabled" @click="compare">在版本比较中查看</BingButton>
          </footer>
        </div>
      </BingCard>
    </div>
  </Teleport>
</template>

<style scoped>
.version-markers { --version-marker-color: var(--bing-warning-strong); position: absolute; inset: 0; pointer-events: none; z-index: 1; user-select: none; }
.is-inserted { --version-marker-color: var(--bing-success-strong); }
.is-deleted { --version-marker-color: var(--bing-red-500); }
.version-markers__stroke { position: absolute; width: 3px; opacity: .8; z-index: 1; }
.version-markers__stroke i { position: absolute; inset: 0; background: var(--version-marker-color); border-radius: 2px; }
.version-markers__stroke.is-deleted { opacity: 1; }
.version-markers__stroke.is-deleted i { inset: 50% auto auto -2.5px; width: 8px; height: 3px; transform: translateY(-50%); }
.version-markers__anchor { position: absolute; display: flex; width: 12px; margin-left: -4px; z-index: 2; }
.version-markers__tooltip { flex: 1; height: 100%; }
.version-markers__hit { display: block; position: absolute; inset: 0 auto 0 0; width: 12px; height: 100%; min-height: 8px; padding: 0; border: 0; background: transparent; cursor: pointer; pointer-events: auto; }
.version-markers__hit i { position: absolute; inset: 0 auto 0 3px; width: 5px; background: var(--version-marker-color); border-radius: 2px; opacity: 0; }
.version-markers__hit.is-joined-before i { border-top-left-radius: 0; border-top-right-radius: 0; }
.version-markers__hit.is-joined-after i { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.version-markers__hit.is-deleted i { inset: 50% auto auto .5px; width: 10px; height: 3px; transform: translateY(-50%); }
.version-markers__hit:hover i, .version-markers__hit:focus-visible i, .version-markers__hit.is-highlighted i, .version-markers__hit[aria-expanded="true"] i { opacity: 1; }
.version-markers__hit:focus-visible, .version-markers__hit.is-highlighted { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.version-markers__content-highlight { position: absolute; z-index: 0; pointer-events: none; border-radius: 6px; background: color-mix(in srgb, var(--version-marker-color) 14%, transparent); opacity: .65; animation: version-block-emphasis 700ms ease-out; }
.version-content-highlight-leave-active { animation: none; transition: opacity 160ms ease-out; }
.version-content-highlight-leave-to { opacity: 0; }
@keyframes version-block-emphasis { 0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: .65; } }
@media (prefers-reduced-motion: reduce) { .version-markers__content-highlight { animation: none; transition: none; } }
.version-change-card { position: fixed; z-index: 80; width: min(480px, calc(100vw - 24px)); max-width: calc(100vw - 24px); color: var(--rb-ink); }
.version-change-card__content { display: flex; flex-direction: column; gap: 10px; max-height: var(--version-card-height, 360px); padding: 12px; box-sizing: border-box; }
.version-change-card__content header, .version-change-card__content footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.version-change-card__content header strong { margin-right: auto; }
.version-change-card__content header span, .version-change-card__reason, .version-change-card__pair small { font-size: 12px; color: var(--rb-muted); }
.version-change-card__body { min-height: 0; flex: 1 1 auto; }
.version-change-card__pair { display: grid; gap: 8px; }
.version-change-card__reason { margin: 0; }
@media (pointer: coarse) { .version-markers__anchor, .version-markers__hit { width: 24px; } }
</style>
