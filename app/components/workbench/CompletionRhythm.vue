<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { BingScrollbar, BingTabs, type BingScrollbarExpose, type BingTabValue } from '@moubing/bing-ui'
import { COMPLETION_WEEKS, shiftDay, type CompletionScope, type WorkbenchCompletion, type WorkbenchCompletions } from '#shared/workbench/home'

const props = defineProps<{ data: WorkbenchCompletions; scope: CompletionScope; pending: boolean }>()
const emit = defineEmits<{ scope: [scope: CompletionScope] }>()
const scopeModel = computed<BingTabValue>({ get: () => props.scope, set: value => emit('scope', value as CompletionScope) })
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7

const byDate = computed(() => {
  const map = new Map<string, WorkbenchCompletion[]>()
  for (const item of props.data.items) map.set(item.date, [...(map.get(item.date) ?? []), item])
  return map
})
type Day = { date: string; state: 'future' | 'unknown' | 'known'; items: WorkbenchCompletion[] }
const weeks = computed(() => Array.from({ length: COMPLETION_WEEKS }, (_, week) => {
  const days: Day[] = Array.from({ length: 7 }, (_, day) => {
    const date = shiftDay(props.data.startDate, week * 7 + day)
    const state = date > props.data.today ? 'future' : date < props.data.dataStart ? 'unknown' : 'known'
    return { date, state, items: state === 'known' ? byDate.value.get(date) ?? [] : [] }
  })
  const first = days[0]!.date, month = Number(first.slice(5, 7))
  // 每月第一次出现的那一周标注；首周若下一周就换月则不标，避免两个月份挤在一起。
  const next = Number(shiftDay(first, 7).slice(5, 7)), previous = Number(shiftDay(first, -7).slice(5, 7))
  const label = (week === 0 ? next === month : previous !== month) ? `${month}月` : ''
  return { days, label }
}))
const allDays = computed(() => weeks.value.flatMap(week => week.days))
const total = computed(() => props.data.items.length)
const level = (count: number) => count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4

const pinned = ref<string | null>(null)
const hovered = ref<string | null>(null)
const aimed = ref<string | null>(null)
const PREVIEW_DELAY_MS = 160
let previewTimer: ReturnType<typeof setTimeout> | undefined
const pointerInside = ref(false)
const keyboardInside = ref(false)
const detailScroll = ref<BingScrollbarExpose | null>(null)
const detailContent = ref<HTMLElement | null>(null)
// 默认展示最近一个有完成记录的日子，而不是可能为空的今天。
const latest = computed(() => allDays.value.filter(day => day.items.length).at(-1)?.date ?? props.data.today)
const focusDay = computed(() => allDays.value.find(day => day.date === (hovered.value ?? pinned.value ?? latest.value))
  ?? allDays.value.find(day => day.date === latest.value))
const indicatorDate = computed(() => aimed.value ?? focusDay.value?.date)
const indicatorIndex = computed(() => allDays.value.findIndex(day => day.date === indicatorDate.value))
const indicatorStyle = computed(() => ({ '--indicator-column': Math.floor(indicatorIndex.value / 7), '--indicator-row': indicatorIndex.value % 7 }))
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 周${WEEKDAYS[weekday(date)]}`
const cellLabel = (day: Day) => day.state === 'unknown' ? `${dateLabel(day.date)}，无记录` : `${dateLabel(day.date)}，完成 ${day.items.length} 条`

// 日历、间隙和详情共用预览状态；鼠标点过日期留下的焦点不能阻止离开后恢复。
function enterRegion(event: PointerEvent) { if (event.pointerType !== 'touch') pointerInside.value = true }
function cancelPreview() { clearTimeout(previewTimer); previewTimer = undefined }
function leaveCalendar() { cancelPreview(); aimed.value = null }
function leaveRegion() { leaveCalendar(); pointerInside.value = false; if (!keyboardInside.value) hovered.value = null }
function preview(date: string, event: PointerEvent) {
  if (event.pointerType === 'touch') return
  cancelPreview()
  aimed.value = date
  const cell = event.currentTarget as HTMLElement
  // 框立即移动，内容等光标在同一格停稳；滚动或离开后不能提交过期预览。
  previewTimer = setTimeout(() => {
    previewTimer = undefined
    if (pointerInside.value && aimed.value === date && cell.matches(':hover')) hovered.value = date
  }, PREVIEW_DELAY_MS)
}
function focusDate(date: string) { leaveCalendar(); hovered.value = date }
function focusRegion(event: FocusEvent) { keyboardInside.value = (event.target as HTMLElement).matches(':focus-visible') }
function blurRegion(event: FocusEvent) {
  if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
  keyboardInside.value = false
  if (!pointerInside.value) hovered.value = null
}
function togglePin(date: string) {
  cancelPreview()
  pinned.value = pinned.value === date ? null : date
  hovered.value = pointerInside.value ? date : null
  aimed.value = pointerInside.value ? date : null
}
function clearPin() { leaveCalendar(); pinned.value = null; hovered.value = null }
watch([() => props.scope, () => props.data.startDate], leaveCalendar)
onScopeDispose(cancelPreview)
watch([() => focusDay.value?.date, () => props.data.scope], async (_value, _previous, onCleanup) => {
  let cancelled = false
  let animation: Animation | undefined
  onCleanup(() => { cancelled = true; animation?.cancel() })
  await nextTick()
  if (cancelled) return
  detailScroll.value?.scrollTo(0)
  const content = detailContent.value
  if (!content || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // 保留内容节点与外壳，只在日期/范围切换后轻量入场，不等待旧内容退场。
  animation = content.animate([
    { opacity: 0.5, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], { duration: 160, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' })
})
</script>

<template>
  <div class="rhythm" :aria-busy="pending" :style="{ '--rhythm-preview-duration': `${PREVIEW_DELAY_MS}ms` }">
    <div class="rhythm__toolbar">
      <BingTabs v-model="scopeModel" :items="[{ value: 'team', label: '团队' }, { value: 'mine', label: '我的' }]" variant="soft" size="sm" ariaLabel="完成节奏范围" />
      <span class="rhythm__summary"><strong>{{ total }}</strong> 条<span>近 {{ COMPLETION_WEEKS }} 周</span></span>
    </div>
    <div class="rhythm__layout" @pointerenter="enterRegion" @pointerleave="leaveRegion" @focusin="focusRegion" @focusout="blurRegion" @keydown.esc.stop.prevent="clearPin">
      <BingScrollbar class="rhythm__scroll" horizontal :vertical="false" aria-label="完成节奏日历" @pointerleave="leaveCalendar" @scroll="leaveCalendar">
        <div class="rhythm__chart">
          <div class="rhythm__calendar" role="grid" :aria-label="`近 ${COMPLETION_WEEKS} 周每日完成数`">
            <div v-if="indicatorIndex >= 0" class="rhythm__indicator" aria-hidden="true" :data-target-date="indicatorDate" :style="indicatorStyle"
              :class="{ 'is-pinned': indicatorDate === pinned, 'is-keyboard': keyboardInside && !aimed }" />
            <div class="rhythm__weekdays" aria-hidden="true"><span />
              <span v-for="(name, index) in WEEKDAYS" :key="name">{{ index % 2 === 0 ? name : '' }}</span>
            </div>
            <div v-for="(week, index) in weeks" :key="index" class="rhythm__week" role="row">
              <span class="rhythm__month" aria-hidden="true">{{ week.label }}</span>
              <span v-for="day in week.days" :key="day.date" role="gridcell">
                <button v-if="day.state !== 'future'" type="button" class="rhythm__cell" :data-level="level(day.items.length)" :data-state="day.state" :data-date="day.date"
                  :class="{ 'is-today': day.date === data.today, 'is-pinned': day.date === pinned }" :aria-label="cellLabel(day)" :aria-pressed="day.date === pinned"
                  @pointerenter="preview(day.date, $event)" @pointerleave="cancelPreview" @focus="focusDate(day.date)"
                  @click="togglePin(day.date)" />
              </span>
            </div>
          </div>
          <div class="rhythm__legend" aria-hidden="true">
            <span>少</span><i v-for="n in 5" :key="n" class="rhythm__cell" :data-level="n - 1" data-state="known" /><span>多</span>
          </div>
        </div>
      </BingScrollbar>
      <aside class="rhythm__detail" :data-preview-date="focusDay?.date">
        <div ref="detailContent" class="rhythm__detail-content">
          <header class="rhythm__detail-head" aria-live="polite">
            <h3>{{ focusDay ? dateLabel(focusDay.date) : '' }}<small v-if="focusDay?.date === data.today">今天</small></h3>
            <span v-if="focusDay?.state === 'known'" class="rhythm__count">完成 <b>{{ focusDay.items.length }}</b> 条</span>
            <span v-if="pending" class="rhythm__loading" role="status">更新中…</span>
          </header>
          <p v-if="focusDay?.state === 'unknown'" class="rhythm__empty">无记录</p>
          <p v-else-if="!focusDay?.items.length" class="rhythm__empty">没有完成</p>
          <BingScrollbar v-else ref="detailScroll" class="rhythm__detail-scroll" aria-label="当天完成的文档" height="100%">
            <ul>
              <li v-for="item in focusDay.items" :key="item.id">
                <NuxtLink :to="`/requirements/${item.id}`"><span>{{ item.key }}</span>{{ item.title }}</NuxtLink>
              </li>
            </ul>
          </BingScrollbar>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.rhythm { --cell: 22px; --gap: 4px; --rhythm-axis: 18px; --done: #198754; --rhythm-chart-height: calc(var(--desk-summary-height, 300px) - 44px); container-type: inline-size; }
.rhythm__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 32px; margin: 0 0 12px; }
.rhythm__summary { display: inline-flex; align-items: baseline; gap: 5px; flex: none; white-space: nowrap; color: var(--bing-muted); font-size: 12px; }
.rhythm__summary > span { margin-left: 4px; }
.rhythm__summary strong { color: var(--bing-heading); font-size: 16px; font-variant-numeric: tabular-nums; }
.rhythm__layout { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; height: var(--rhythm-chart-height); align-items: stretch; }
.rhythm__scroll { min-width: 0; align-self: start; }
.rhythm__chart { width: max-content; padding: 4px; }
.rhythm__calendar { position: relative; display: flex; gap: var(--gap); width: max-content; }
.rhythm__indicator {
  position: absolute; z-index: 1; pointer-events: none;
  left: calc(var(--rhythm-axis) + var(--gap) - 3px); top: calc(var(--rhythm-axis) + var(--gap) - 3px);
  width: calc(var(--cell) + 6px); height: calc(var(--cell) + 6px); border: 2px solid var(--bing-heading); border-radius: 6px;
  transform: translate(calc(var(--indicator-column) * (var(--cell) + var(--gap))), calc(var(--indicator-row) * (var(--cell) + var(--gap))));
  transition: transform var(--rhythm-preview-duration) cubic-bezier(0.2, 0.7, 0.3, 1), border-color var(--rhythm-preview-duration) ease;
}
.rhythm__indicator.is-pinned { border-color: var(--ui-accent); }
.rhythm__indicator.is-keyboard { transition: none; }
.rhythm__weekdays, .rhythm__week { display: grid; grid-template-rows: var(--rhythm-axis) repeat(7, var(--cell)); gap: var(--gap); }
.rhythm__weekdays { width: var(--rhythm-axis); color: var(--bing-muted); font-size: 11px; line-height: var(--cell); }
.rhythm__month { width: var(--cell); overflow: visible; color: var(--bing-muted); font-size: 11px; line-height: 18px; white-space: nowrap; }
.rhythm__week > span[role="gridcell"] { display: block; width: var(--cell); height: var(--cell); }
.rhythm__cell {
  --fill: 0%;
  display: block; width: var(--cell); height: var(--cell); padding: 0; border: 0; border-radius: 3px;
  background: color-mix(in srgb, var(--done) var(--fill), var(--ui-navigation)); cursor: pointer;
}
.rhythm__cell[data-level="0"] { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bing-border) 60%, transparent); }
.rhythm__cell[data-level="1"] { --fill: 25%; }
.rhythm__cell[data-level="2"] { --fill: 48%; }
.rhythm__cell[data-level="3"] { --fill: 70%; }
.rhythm__cell[data-level="4"] { --fill: 92%; }
.rhythm__cell[data-state="unknown"] { background: repeating-linear-gradient(135deg, var(--ui-navigation) 0 3px, color-mix(in srgb, var(--bing-border) 70%, transparent) 3px 4px); box-shadow: none; cursor: default; }
.rhythm__cell:focus-visible { outline: 2px solid var(--bing-heading); outline-offset: 1px; }
.rhythm__cell.is-today { box-shadow: 0 0 0 1.5px var(--ui-accent); }
.rhythm__cell.is-pinned { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.rhythm__legend { display: flex; align-items: center; gap: 4px; margin-top: 12px; color: var(--bing-muted); font-size: 11px; }
.rhythm__legend .rhythm__cell { width: 12px; height: 12px; cursor: default; }
.rhythm__detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; padding: 0 12px 12px; border-radius: 8px; background: var(--ui-navigation); }
.rhythm__detail-content { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.rhythm__detail-head { display: flex; flex-wrap: wrap; align-content: center; align-items: center; gap: 4px 8px; flex: none; height: 60px; }
.rhythm__detail h3 { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--bing-heading); font-size: 13px; }
.rhythm__count, .rhythm__loading { color: var(--bing-muted); font-size: 12px; white-space: nowrap; }
.rhythm__count b { color: var(--bing-heading); font-variant-numeric: tabular-nums; }
.rhythm__loading { margin-left: auto; }
.rhythm__detail-scroll { flex: 1; min-height: 0; }
.rhythm__detail small { padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, var(--ui-accent) 12%, transparent); color: var(--ui-accent); font-size: 11px; font-weight: 500; }
.rhythm__detail ul { display: grid; gap: 2px; margin: 0; padding: 3px; list-style: none; }
.rhythm__detail a { display: block; padding: 6px; border-radius: 4px; color: var(--bing-heading); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rhythm__detail a:hover { background: var(--bing-surface-solid); }
.rhythm__detail a span { margin-right: 8px; color: var(--bing-muted); font-variant-numeric: tabular-nums; }
.rhythm__empty { display: grid; place-content: center; flex: 1; margin: 0; color: var(--bing-muted); font-size: 13px; }
@container (max-width: 620px) { .rhythm__layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--rhythm-chart-height) 176px; height: auto; } }
@media (pointer: coarse) { .rhythm { --cell: 24px; } }
@media (prefers-reduced-motion: reduce) { .rhythm__indicator { transition: none; } }
</style>
