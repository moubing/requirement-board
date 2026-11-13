<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-vue-next'
import { BingButton, BingCheckbox, BingIcon, BingScrollbar, BingTabs, type BingScrollbarExpose } from '@moubing/bing-ui'
import { useDiffLayout } from '~/composables/use-diff-layout'
import { scrollToContent } from '~/utils/scroll-to-content'

import type { RichTextDocument } from '~~/shared/editor/document'
import type { DiffBlockPair } from '~~/shared/diff/rich-text-diff'
import type { ContentComparison } from '~~/shared/diff/version-markers'
import { useCachedRichTextDiff } from '../../composables/use-cached-rich-text-diff'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import DiffBlockRenderer from './DiffBlockRenderer.vue'
import DiffChangeGutter from './DiffChangeGutter.vue'
import RequirementChapterLinks from '../editor/RequirementChapterLinks.vue'

const props = withDefaults(
  defineProps<{
    base: RichTextDocument | null
    target: RichTextDocument | null
    requirementId?: string
    baseLabel?: string
    targetLabel?: string
    collapseUnchanged?: boolean
    revertible?: boolean
    fillHeight?: boolean
    active?: boolean
    comparisonKey?: string
    cacheScope?: string
    comparison?: ContentComparison | null
    focusChange?: { blockId: string; request: number } | null
  }>(),
  {
    collapseUnchanged: false,
    baseLabel: '旧版本',
    targetLabel: '当前版本',
    revertible: false,
    fillHeight: false,
    active: true,
    comparisonKey: '',
    cacheScope: '',
  },
)

const emit = defineEmits<{
  (event: 'revert-change', payload: { status: ChangeStatus; pairs: DiffBlockPair[] }): void
}>()

type DisplayRow =
  | { kind: 'pair'; pair: DiffBlockPair }
  | { kind: 'hunk'; hunk: ChangeHunk }
  | { kind: 'fold'; id: string; count: number; pairs: DiffBlockPair[] }

type ChangeStatus = Exclude<DiffBlockPair['status'], 'unchanged'>

interface ChangeHunk {
  id: string
  status: ChangeStatus
  pairs: DiffBlockPair[]
}

const expandedGroups = ref<Set<string>>(new Set())
const root = ref<HTMLElement | null>(null)
const layout = useDiffLayout(root, () => props.active)
const layouts = [{ value: 'split', label: '并排' }, { value: 'unified', label: '统一' }]
const showOnlyChanged = ref(false)
const activeChangeId = ref<string | null>(null)
const rowRefs = ref<Record<string, HTMLElement | null>>({})
const rowsRef = ref<HTMLElement | null>(null)
const diffScrollbar = ref<BingScrollbarExpose | null>(null)
const mapHeight = ref(0)
const mapMarks = ref<Record<string, { top: number; height: number }>>({})
let resizeObserver: ResizeObserver | null = null
let measureFrame = 0

const diff = useCachedRichTextDiff({ active: () => props.active, base: () => props.base, target: () => props.target,
  key: () => props.comparisonKey, scope: () => props.cacheScope, comparison: () => props.comparison })
type ViewState = { expanded: Set<string>; change: string | null; onlyChanged: boolean; top: number; left: number }
const viewStates = new Map<string, ViewState>()
let viewKey = props.comparisonKey
let restoreFrame = 0
let restoreGeneration = 0
let restorePending = true
function rememberView() {
  const viewport = diffScrollbar.value?.viewport
  // KeepAlive 移出 DOM 后 scrollTop 可能归零；恢复中的临时滚动也不能覆盖快照。
  // isConnected 不触发布局，避免为判定可见性同步读取 clientWidth。
  if (!viewport?.isConnected || restorePending) return
  viewStates.delete(viewKey)
  viewStates.set(viewKey, { expanded: expandedGroups.value, change: activeChangeId.value, onlyChanged: showOnlyChanged.value,
    top: viewport.scrollTop, left: viewport.scrollLeft })
  if (viewStates.size > 2) viewStates.delete(viewStates.keys().next().value!)
}
function restoreViewScroll() {
  const generation = ++restoreGeneration
  cancelAnimationFrame(restoreFrame)
  if (!restorePending || !props.active || !diff.value) return
  void nextTick(() => {
    if (!props.active || generation !== restoreGeneration) return
    restoreFrame = requestAnimationFrame(() => {
      const state = viewStates.get(viewKey), viewport = diffScrollbar.value?.viewport
      if (props.active && generation === restoreGeneration && viewport) {
        viewport.scrollTop = state?.top ?? 0
        viewport.scrollLeft = state?.left ?? 0
        restorePending = false
      }
    })
  })
}
watch([() => props.active, () => props.comparisonKey], ([active, key], [wasActive]) => {
  if (wasActive) rememberView()
  restorePending = true
  if (key !== viewKey) {
    viewKey = key
    const state = viewStates.get(key)
    expandedGroups.value = state?.expanded ?? new Set()
    activeChangeId.value = state?.change ?? null
    showOnlyChanged.value = state?.onlyChanged ?? false
  }
  if (active) restoreViewScroll()
  else { restoreGeneration++; cancelAnimationFrame(restoreFrame) }
}, { flush: 'sync' })
watch(() => props.cacheScope, () => { viewStates.clear(); expandedGroups.value = new Set(); activeChangeId.value = null; restorePending = true })
watch(diff, restoreViewScroll, { flush: 'post' })
onBeforeUnmount(() => { restoreGeneration++; cancelAnimationFrame(restoreFrame); viewStates.clear() })
const changeHunks = computed(() => buildChangeHunks(diff.value?.pairs ?? []))
let focusedRequest: object | null = null
watch([() => props.focusChange, () => props.active, diff], async () => {
  const request = props.focusChange
  if (!request || request === focusedRequest || !props.active || !diff.value) return
  const hunk = changeHunks.value.find(item => item.pairs.some(pair => pair.id === request.blockId || pair.base?.id === request.blockId || pair.target?.id === request.blockId))
  if (!hunk) return
  focusedRequest = request
  await nextTick()
  // 定位请求优先于该版本对的旧滚动位置。
  restoreGeneration++; cancelAnimationFrame(restoreFrame); restorePending = false
  focusChange(hunk.id)
}, { flush: 'post', immediate: true })
const activeChangeIndex = computed(() => changeHunks.value.findIndex((hunk) => hunk.id === activeChangeId.value))
const changeSummary = computed(() =>
  changeHunks.value.reduce(
    (summary, hunk) => {
      summary[hunk.status] += 1
      return summary
    },
    { inserted: 0, deleted: 0, modified: 0 } as Record<ChangeStatus, number>,
  ),
)
const changePositionText = computed(() => {
  if (!diff.value) return '— / —'
  if (!changeHunks.value.length) return '0 / 0'
  const current = activeChangeIndex.value === -1 ? 0 : activeChangeIndex.value + 1
  return `${current} / ${changeHunks.value.length}`
})

const displayRows = computed<DisplayRow[]>(() => {
  const rows: DisplayRow[] = []
  let unchangedBuffer: DiffBlockPair[] = []

  const flush = () => {
    if (!unchangedBuffer.length) return
    const first = unchangedBuffer[0]!
    const id = `fold_${rows.length}_${first.id}`
    if (unchangedBuffer.length <= 2 || expandedGroups.value.has(id)) {
      rows.push(...unchangedBuffer.map((pair) => ({ kind: 'pair' as const, pair })))
    } else {
      rows.push({ kind: 'fold', id, count: unchangedBuffer.length, pairs: unchangedBuffer })
    }
    unchangedBuffer = []
  }

  const pairs = diff.value?.pairs ?? []
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!
    if (pair.status === 'unchanged') {
      if (showOnlyChanged.value) continue
      if (props.collapseUnchanged) unchangedBuffer.push(pair)
      else rows.push({ kind: 'pair', pair })
      continue
    }

    flush()

    if (isMergeableStatus(pair.status)) {
      const startIndex = index
      const group = [pair]
      while (index + 1 < pairs.length && pairs[index + 1]!.status === pair.status) {
        group.push(pairs[index + 1]!)
        index += 1
      }

      if (group.length > 1) {
        rows.push({ kind: 'hunk', hunk: createChangeHunk(pair.status, group, startIndex) })
        continue
      }
    }

    rows.push({ kind: 'pair', pair })
  }

  flush()
  return rows
})

watch(
  changeHunks,
  (hunks) => {
    if (hunks.some((hunk) => hunk.id === activeChangeId.value)) return
    activeChangeId.value = hunks[0]?.id ?? null
  },
  { immediate: true },
)

watch(
  displayRows,
  () => {
    scheduleMapMeasure()
  },
  { immediate: true, flush: 'post' },
)
watch(layout, () => { void nextTick(scheduleMapMeasure) })
watch(rowsRef, (element) => {
  resizeObserver?.disconnect()
  if (element && props.active) resizeObserver?.observe(element)
  scheduleMapMeasure()
}, { flush: 'post' })

useActiveVisualEffect(() => props.active, () => {
  scheduleMapMeasure()
  // KeepAlive 停用钩子执行时 DOM 可能已经脱离布局；可见滚动时先保留位置。
  const viewport = diffScrollbar.value?.viewport
  viewport?.addEventListener('scroll', rememberView, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleMapMeasure)
    if (rowsRef.value) resizeObserver.observe(rowsRef.value)
  }
  window.addEventListener('resize', scheduleMapMeasure)
  return () => {
    viewport?.removeEventListener('scroll', rememberView)
    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('resize', scheduleMapMeasure)
    cancelAnimationFrame(measureFrame)
    measureFrame = 0
    diffScrollbar.value?.stop()
  }
})

function toggleFold(id: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedGroups.value = next
}

function setRowRef(id: string, element: Element | ComponentPublicInstance | null) {
  if (!element) {
    delete rowRefs.value[id]
    return
  }

  const target = element instanceof Element ? element : element.$el
  rowRefs.value[id] = target instanceof HTMLElement ? target : null
}

function focusChange(id: string) {
  if (!props.active) return
  activeChangeId.value = id
  void nextTick(() => {
    scrollToContent(diffScrollbar.value, rowRefs.value[id], root.value?.querySelector('.rich-diff__labels')?.clientHeight ?? 0)
  })
}

function scheduleMapMeasure() {
  if (!props.active || measureFrame || typeof requestAnimationFrame === 'undefined') return
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0
    if (props.active) measureMapMarks()
  })
}

function measureMapMarks() {
  const rowsElement = rowsRef.value
  if (!rowsElement) {
    mapHeight.value = 0
    mapMarks.value = {}
    return
  }

  const rowsRect = rowsElement.getBoundingClientRect()
  const marks: Record<string, { top: number; height: number }> = {}

  for (const hunk of changeHunks.value) {
    const rowElement = rowRefs.value[hunk.id]
    if (!rowElement) continue

    const rowRect = rowElement.getBoundingClientRect()
    marks[hunk.id] = {
      top: Math.max(0, rowRect.top - rowsRect.top),
      height: Math.max(8, rowRect.height),
    }
  }

  mapHeight.value = rowsElement.scrollHeight
  const previous = mapMarks.value
  if (Object.keys(previous).length !== Object.keys(marks).length || Object.entries(marks).some(([id, mark]) =>
    previous[id]?.top !== mark.top || previous[id]?.height !== mark.height)) mapMarks.value = marks
}

function mapMarkStyle(id: string) {
  const mark = mapMarks.value[id]
  if (!mark || !mapHeight.value) return { top: '0px', visibility: 'hidden' as const }

  const progress = Math.min(1, mark.top / mapHeight.value)
  return {
    top: `calc(${progress * 100}% - ${progress * 12}px)`,
  }
}

function navigateChange(direction: -1 | 1) {
  const hunks = changeHunks.value
  if (!hunks.length) return

  const currentIndex = activeChangeIndex.value
  const nextIndex =
    currentIndex === -1
      ? direction > 0
        ? 0
        : hunks.length - 1
      : (currentIndex + direction + hunks.length) % hunks.length

  focusChange(hunks[nextIndex]!.id)
}

function rowKey(row: DisplayRow) {
  if (row.kind === 'pair') return row.pair.id
  if (row.kind === 'hunk') return row.hunk.id
  return row.id
}

function isMergeableStatus(status: DiffBlockPair['status']): status is 'inserted' | 'deleted' {
  return status === 'inserted' || status === 'deleted'
}

function buildChangeHunks(pairs: DiffBlockPair[]) {
  const hunks: ChangeHunk[] = []

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!
    if (pair.status === 'unchanged') continue

    if (isMergeableStatus(pair.status)) {
      const startIndex = index
      const group = [pair]
      while (index + 1 < pairs.length && pairs[index + 1]!.status === pair.status) {
        group.push(pairs[index + 1]!)
        index += 1
      }
      hunks.push(createChangeHunk(pair.status, group, startIndex))
      continue
    }

    hunks.push(createChangeHunk(pair.status, [pair], index))
  }

  return hunks
}

function createChangeHunk(status: ChangeStatus, pairs: DiffBlockPair[], startIndex: number): ChangeHunk {
  if (pairs.length === 1) {
    return { id: pairs[0]!.id, status, pairs }
  }

  return {
    id: `hunk_${status}_${startIndex}_${pairs[0]!.id}_${pairs[pairs.length - 1]!.id}`,
    status,
    pairs,
  }
}

function revertHunk(hunk: ChangeHunk) {
  if (!props.revertible) return
  emit('revert-change', { status: hunk.status, pairs: hunk.pairs })
}

function revertPair(pair: DiffBlockPair) {
  if (!props.revertible || pair.status === 'unchanged') return
  emit('revert-change', { status: pair.status, pairs: [pair] })
}

function mapMarkLabel(hunk: ChangeHunk, index: number) {
  const statusLabels: Record<ChangeStatus, string> = {
    inserted: '新增',
    deleted: '删除',
    modified: '修改',
  }

  return `${index + 1}. ${statusLabels[hunk.status]}`
}
</script>

<template>
  <section ref="root" class="rich-diff" :class="{ 'rich-diff--unified': layout === 'unified', 'rich-diff--fill': fillHeight }">
    <div v-if="$slots.options" class="rich-diff__options"><slot name="options" /></div>
    <header class="rich-diff__header" :class="{ 'rich-diff__header--with-versions': $slots.versions }">
      <slot name="versions"><h2>版本比较</h2></slot>
      <div class="rich-diff__header-actions">
        <BingTabs v-model="layout" :items="layouts" size="sm" variant="soft" aria-label="差异布局" />
        <BingCheckbox v-model="showOnlyChanged" size="sm" label="仅变化" :disabled="!diff" />
        <div class="rich-diff__nav" aria-label="变更导航">
          <BingButton
            size="sm"
            variant="ghost"
            rounded="sm"
            :disabled="!changeHunks.length"
            :throttle="false"
            aria-label="上一处变更"
            @click="navigateChange(-1)"
          >
            <template #prefix>
              <BingIcon :icon="ArrowUp" :size="16" decorative />
            </template>
          </BingButton>
          <BingButton
            size="sm"
            variant="ghost"
            rounded="sm"
            :disabled="!changeHunks.length"
            :throttle="false"
            aria-label="下一处变更"
            @click="navigateChange(1)"
          >
            <template #prefix>
              <BingIcon :icon="ArrowDown" :size="16" decorative />
            </template>
          </BingButton>
          <span class="rich-diff__nav-count">{{ changePositionText }}</span>
        </div>

        <div class="rich-diff__summary" aria-label="Diff 统计">
          <span class="rich-diff__summary-item rich-diff__summary-item--inserted" :title="`新增 ${diff ? changeSummary.inserted : '—'} 处`">+{{ diff ? changeSummary.inserted : '—' }}</span>
          <span class="rich-diff__summary-item rich-diff__summary-item--deleted" :title="`删除 ${diff ? changeSummary.deleted : '—'} 处`">-{{ diff ? changeSummary.deleted : '—' }}</span>
          <span class="rich-diff__summary-item rich-diff__summary-item--modified" :title="`修改 ${diff ? changeSummary.modified : '—'} 处`">~{{ diff ? changeSummary.modified : '—' }}</span>
        </div>
      </div>
    </header>

    <div class="rich-diff__content">
    <BingScrollbar
      v-if="diff"
      ref="diffScrollbar"
      class="rich-diff__body"
      horizontal
      :height="fillHeight ? '100%' : undefined"
      :max-height="fillHeight ? undefined : 'var(--diff-viewport-height, 68vh)'"
      always
      smooth
      aria-label="版本差异内容"
    >
      <div class="rich-diff__body-content">
        <div v-if="layout === 'split'" class="rich-diff__labels">
          <span :title="baseLabel">{{ baseLabel }}</span>
          <span>变更</span>
          <span :title="targetLabel">{{ targetLabel }}</span>
        </div>
        <div ref="rowsRef" class="rich-diff__rows" style="position: relative">
          <RequirementChapterLinks v-if="requirementId" inline :requirement-id="requirementId" :surface="rowsRef" :active="active"
            :get-viewport="() => diffScrollbar?.viewport" />
          <p v-if="showOnlyChanged && !displayRows.length" class="workspace-empty">两个版本的正文没有差异。</p>
          <template v-for="row in displayRows" :key="rowKey(row)">
            <div v-if="row.kind === 'fold'" class="rich-diff__fold">
              <BingButton size="sm" variant="ghost" rounded="sm" @click="toggleFold(row.id)">
                <template #prefix>
                  <BingIcon :icon="ChevronsUpDown" :size="15" decorative />
                </template>
                展开 {{ row.count }} 个未改动块
              </BingButton>
            </div>

            <div
              v-else-if="row.kind === 'hunk'"
              :ref="(element) => setRowRef(row.hunk.id, element)"
              class="rich-diff__row rich-diff__row--hunk"
              :class="[
                `rich-diff__row--${row.hunk.status}`,
                { 'rich-diff__row--active': row.hunk.id === activeChangeId },
              ]"
              :aria-current="row.hunk.id === activeChangeId ? 'true' : undefined"
            >
              <template v-if="layout === 'unified'">
                <div class="rich-diff__unified-heading">
                  <span>{{ row.hunk.status === 'deleted' ? baseLabel : targetLabel }}</span>
                  <DiffChangeGutter :status="row.hunk.status" :revertible="revertible" hunk @revert="revertHunk(row.hunk)" />
                </div>
                <div class="rich-diff__unified-content" :class="`rich-diff__unified-content--${row.hunk.status}`">
                  <DiffBlockRenderer v-for="pair in row.hunk.pairs" :key="pair.id" :pair="pair" :side="row.hunk.status === 'deleted' ? 'base' : 'target'" />
                </div>
              </template>
              <template v-else>
                <div class="rich-diff__hunk-side" :class="{ 'rich-diff__hunk-side--empty': row.hunk.status === 'inserted' }">
                  <template v-if="row.hunk.status === 'deleted'">
                    <DiffBlockRenderer v-for="pair in row.hunk.pairs" :key="pair.id" :pair="pair" side="base" />
                  </template>
                </div>
                <DiffChangeGutter
                  :status="row.hunk.status"
                  :revertible="revertible"
                  hunk
                  @revert="revertHunk(row.hunk)"
                />
                <div class="rich-diff__hunk-side" :class="{ 'rich-diff__hunk-side--empty': row.hunk.status === 'deleted' }">
                  <template v-if="row.hunk.status === 'inserted'">
                    <DiffBlockRenderer v-for="pair in row.hunk.pairs" :key="pair.id" :pair="pair" side="target" />
                  </template>
                </div>
              </template>
            </div>

            <div
              v-else
              :ref="(element) => setRowRef(row.pair.id, element)"
              class="rich-diff__row"
              :class="[
                `rich-diff__row--${row.pair.status}`,
                { 'rich-diff__row--active': row.pair.id === activeChangeId },
              ]"
              :aria-current="row.pair.id === activeChangeId ? 'true' : undefined"
            >
              <template v-if="layout === 'unified'">
                <div v-if="row.pair.status !== 'unchanged'" class="rich-diff__unified-heading">
                  <span>正文变更</span>
                  <DiffChangeGutter :status="row.pair.status" :revertible="revertible" @revert="revertPair(row.pair)" />
                </div>
                <div v-if="row.pair.status === 'deleted' || row.pair.status === 'modified'" class="rich-diff__unified-content rich-diff__unified-content--deleted">
                  <span class="rich-diff__side-label">旧版本</span><DiffBlockRenderer :pair="row.pair" side="base" />
                </div>
                <div v-if="row.pair.status !== 'deleted'" class="rich-diff__unified-content" :class="{ 'rich-diff__unified-content--inserted': row.pair.status !== 'unchanged' }">
                  <span v-if="row.pair.status !== 'unchanged'" class="rich-diff__side-label">比较目标</span><DiffBlockRenderer :pair="row.pair" side="target" />
                </div>
              </template>
              <template v-else>
                <DiffBlockRenderer :pair="row.pair" side="base" />
                <DiffChangeGutter
                  :status="row.pair.status"
                  :revertible="revertible && row.pair.status !== 'unchanged'"
                  @revert="revertPair(row.pair)"
                />
                <DiffBlockRenderer :pair="row.pair" side="target" />
              </template>
            </div>
          </template>
        </div>
      </div>
    </BingScrollbar>
      <div v-else class="rich-diff__placeholder"><slot name="placeholder"><p class="workspace-empty" role="status">正在加载版本正文…</p></slot></div>

      <aside v-if="diff" class="rich-diff__map" aria-label="Diff 变更小地图">
        <button
          v-for="(hunk, index) in changeHunks"
          :key="hunk.id"
          type="button"
          class="rich-diff__map-mark"
          :class="`rich-diff__map-mark--${hunk.status}`"
          :aria-label="mapMarkLabel(hunk, index)"
          :title="mapMarkLabel(hunk, index)"
          :style="mapMarkStyle(hunk.id)"
          @click="focusChange(hunk.id)"
        />
      </aside>
    </div>
  </section>
</template>
