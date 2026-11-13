<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { BingScrollbar } from '@moubing/bing-ui'
import { requirementListLink } from '~/utils/requirement-list-link'
import { FLOW_STATES, type FlowState, type WorkbenchTeamLoad } from '#shared/workbench/home'

const props = defineProps<{ data: WorkbenchTeamLoad; currentUserId: string | null }>()
const statuses = computed(() => FLOW_STATES.map(code => props.data.statuses.find(status => status.code === code)!))
const total = (counts: Record<FlowState, number>) => FLOW_STATES.reduce((sum, code) => sum + counts[code], 0)
const max = computed(() => Math.max(1, ...props.data.rows.flatMap(row => FLOW_STATES.map(code => row.counts[code]))))
const level = (value: number) => value === 0 ? 0 : Math.ceil((value / max.value) * 4)
type CellTarget = { row: string; col: FlowState; element: HTMLElement }
const hover = shallowRef<CellTarget | null>(null)
const grid = ref<HTMLElement | null>(null)
const indicator = ref<{ x: number; y: number; width: number; height: number; color: string; footer: boolean } | null>(null)
const animated = ref(false)
let pointerTarget: CellTarget | null = null
let keyboardTarget: CellTarget | null = null
let keyboardActive = false
let resizeObserver: ResizeObserver | undefined
let measureFrame: number | undefined
const link = (row: string, statusId: string) => requirementListLink({ assignee: row, statusId })

function measureIndicator(animate: boolean) {
  const target = hover.value, parent = grid.value
  if (!target || !parent) return
  if (!parent.contains(target.element)) {
    hover.value = pointerTarget = keyboardTarget = null
    return
  }
  const cell = target.element.getBoundingClientRect(), origin = parent.getBoundingClientRect()
  animated.value = animate
  indicator.value = { x: cell.left - origin.left - 4, y: cell.top - origin.top - 4, width: cell.width + 8, height: cell.height + 8,
    color: statuses.value.find(status => status.code === target.col)!.color, footer: target.row === 'unassigned' }
}
function syncIndicator() {
  if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
  measureFrame = requestAnimationFrame(() => { measureFrame = undefined; measureIndicator(false) })
}
function enterCell(row: string, col: FlowState, event: PointerEvent) {
  if (event.pointerType === 'touch') return
  keyboardActive = false
  hover.value = pointerTarget = { row, col, element: event.currentTarget as HTMLElement }
}
function leaveTable() {
  pointerTarget = null
  keyboardActive = !!keyboardTarget
  hover.value = keyboardTarget
}
function resumePointer(event: PointerEvent) {
  if (event.pointerType !== 'touch' && keyboardActive && pointerTarget) { keyboardActive = false; hover.value = pointerTarget }
}
function focusCell(row: string, col: FlowState, event: FocusEvent) {
  const cell = event.currentTarget as HTMLElement
  if (!cell.matches(':focus-visible')) return
  keyboardActive = true
  hover.value = keyboardTarget = { row, col, element: cell }
  // 原生 Tab 只避开视口边缘；补上固定表头/页脚的滚动边距，鼠标点击不移动列表。
  if (row !== 'unassigned') cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
function blurCell() {
  keyboardTarget = null
  if (keyboardActive) { keyboardActive = false; hover.value = pointerTarget }
}
watch(hover, (_target, previous) => {
  if (measureFrame !== undefined) { cancelAnimationFrame(measureFrame); measureFrame = undefined }
  measureIndicator(!keyboardActive && !!previous)
}, { flush: 'post' })
watch(() => props.data, syncIndicator, { flush: 'post' })
onMounted(() => {
  resizeObserver = new ResizeObserver(syncIndicator)
  if (grid.value) resizeObserver.observe(grid.value)
})
onScopeDispose(() => {
  resizeObserver?.disconnect()
  if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
})
</script>

<template>
  <div class="load" :class="{ 'is-engaged': hover }" @pointerleave="leaveTable" @pointermove="resumePointer">
    <BingScrollbar class="load__scroll" height="var(--desk-summary-height, 300px)" horizontal aria-label="团队负载表格" @scroll="syncIndicator">
      <div ref="grid" class="load__grid" role="table" aria-label="团队负载：成员 × 状态">
        <div v-if="indicator" class="load__indicator" aria-hidden="true" :data-row="hover?.row" :data-col="hover?.col"
          :class="{ 'is-visible': hover, 'is-animated': animated, 'is-footer': indicator.footer }"
          :style="{ transform: `translate(${indicator.x}px, ${indicator.y}px)`, width: `${indicator.width}px`, height: `${indicator.height}px`, borderColor: indicator.color }" />
        <div class="load__row load__row--head" role="row">
          <span role="columnheader" class="load__corner">成员</span>
          <span v-for="status in statuses" :key="status.id" role="columnheader" class="load__col"
            :class="{ 'is-hot': hover?.col === status.code }" :style="{ '--status': status.color }"><i aria-hidden="true" />{{ status.name }}</span>
          <span role="columnheader" class="load__col load__col--total" title="多人负责的文档在每位负责人下各计一次">合计</span>
        </div>
        <div v-for="row in data.rows" :key="row.id" class="load__row" role="row" :class="{ 'is-hot': hover?.row === row.id, 'is-unassigned': row.id === 'unassigned' }" :data-load-row="row.id">
          <span role="rowheader" class="load__name">
            <i v-if="row.avatarColor" :class="{ 'is-me': row.id === currentUserId }" :style="{ '--avatar': row.avatarColor }" aria-hidden="true">{{ Array.from(row.name)[0] }}</i>
            <i v-else class="is-empty" aria-hidden="true">?</i>
            <span class="load__name-text" :title="row.name">{{ row.name }}</span><span v-if="row.id === currentUserId" class="visually-hidden">（我）</span>
          </span>
          <span v-for="status in statuses" :key="status.id" role="cell">
            <NuxtLink :to="link(row.id, status.id)" class="load__cell" :data-level="level(row.counts[status.code as FlowState])" :style="{ '--status': status.color }"
              :class="{ 'is-cross': hover && (hover.row === row.id || hover.col === status.code) }"
              :aria-label="`${row.name}${status.name} ${row.counts[status.code as FlowState]} 条，查看列表`" :data-load-cell="status.code"
              @pointerenter="enterCell(row.id, status.code as FlowState, $event)" @focus="focusCell(row.id, status.code as FlowState, $event)" @blur="blurCell">{{ row.counts[status.code as FlowState] || '' }}</NuxtLink>
          </span>
          <span role="cell" class="load__total">{{ total(row.counts) }}</span>
        </div>
      </div>
    </BingScrollbar>
  </div>
</template>

<style scoped>
/* 格子间留出 8px，聚焦描边（2px 间隔 + 2px 线）落在缝隙里，不会被相邻格子或滚动容器裁掉。 */
.load { --load-cell-height: 32px; }
.load__scroll { margin-inline: -6px; }
.load__grid { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 332px; min-height: calc(var(--desk-summary-height, 300px) - var(--bing-scrollbar-gutter)); padding: 6px; }
.load__indicator { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; border: 2px solid; border-radius: 10px; opacity: 0; transition: opacity 100ms; }
.load__indicator.is-visible { opacity: 1; }
.load__indicator.is-animated { transition: transform 160ms cubic-bezier(0.2, 0.7, 0.3, 1), width 160ms, height 160ms, border-color 160ms, opacity 100ms; }
.load__indicator.is-footer { z-index: 3; }
.load__row { display: grid; flex: none; grid-template-columns: minmax(112px, 1.5fr) repeat(3, minmax(48px, 1fr)) 36px; gap: 8px; align-items: center; }
.load__row > span { min-width: 0; }
.load__row--head { position: sticky; top: 0; z-index: 2; margin-top: -6px; padding-block: 6px; background: var(--bing-surface-solid); color: var(--bing-muted); font-size: 12px; }
.load__corner { padding-left: 2px; }
.load__col { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; transition: color 100ms; }
.load__col i { width: 6px; height: 6px; border-radius: 50%; background: var(--status); }
.load__col.is-hot { color: var(--bing-heading); font-weight: 600; }
.load__col--total { justify-content: flex-end; padding-right: 2px; cursor: help; }
.load__name { display: flex; align-items: center; gap: 8px; padding-left: 2px; color: var(--bing-heading); font-size: 13px; white-space: nowrap; }
.load__name-text { overflow: hidden; text-overflow: ellipsis; }
.load__name i { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--avatar); color: #fff; font-size: 11px; font-style: normal; font-weight: 700; }
.load__name i.is-empty { background: none; border: 1px dashed var(--bing-muted); color: var(--bing-muted); }
.load__name i.is-me { box-shadow: 0 0 0 2px var(--bing-surface-solid), 0 0 0 3.5px var(--ui-accent); }
.load__row.is-hot .load__name { font-weight: 600; }
.load__row.is-unassigned { position: sticky; bottom: calc(var(--bing-scrollbar-gutter) + 6px); z-index: 2; margin-top: auto; padding-block: 10px 6px; background: var(--bing-surface-solid); border-top: 1px dashed var(--bing-border); box-shadow: 0 calc(var(--bing-scrollbar-gutter) + 6px) 0 var(--bing-surface-solid); }
.load__cell {
  --fill: 0%;
  position: relative; display: grid; place-items: center; height: var(--load-cell-height); border-radius: 6px; scroll-margin-block: 40px calc(var(--load-cell-height) + var(--bing-scrollbar-gutter) + 32px);
  background: color-mix(in srgb, var(--status) var(--fill), var(--ui-navigation));
  color: var(--bing-heading); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums;
  outline: 2px solid transparent; outline-offset: 2px;
  transition: opacity 160ms;
}
.load__cell[data-level="1"] { --fill: 16%; }
.load__cell[data-level="2"] { --fill: 32%; }
.load__cell[data-level="3"] { --fill: 55%; color: #fff; }
.load__cell[data-level="4"] { --fill: 80%; color: #fff; }
.load.is-engaged .load__cell:not(.is-cross) { opacity: 0.45; }
.workspace-page .load__cell:focus-visible { z-index: 1; outline-color: var(--status); outline-offset: 2px; }
.load__total { color: var(--bing-muted); font-size: 12px; text-align: right; padding-right: 2px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .load__cell, .load__col, .load__indicator, .load__indicator.is-animated { transition: none; } }
@media (pointer: coarse) { .load { --load-cell-height: 44px; } }
@media (max-width: 480px) {
  .load__grid { min-width: 312px; }
  .load__row { grid-template-columns: minmax(84px, 1fr) repeat(3, minmax(48px, 56px)) 24px; gap: 6px; }
  .load__col i { display: none; }
}
</style>
