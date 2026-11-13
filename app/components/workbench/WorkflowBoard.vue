<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  BingButton, BingDragDrop, BingDraggable, BingDragOverlay, BingDropDown, BingDropDownItem, BingDropZone, BingIcon, BingScrollbar, BingTabs,
  type BingDragDropDropPayload, type BingTabValue,
} from '@moubing/bing-ui'
import { CheckCheck, Ellipsis, ExternalLink, Inbox } from 'lucide-vue-next'
import WorkflowCard from './WorkflowCard.vue'
import { requirementListLink } from '~/utils/requirement-list-link'
import { FLOW_STATES, staleLevel, TASK_FLOW_STATES, type TaskFlowState, type WorkbenchFlow, type WorkbenchFlowCard } from '#shared/workbench/home'

const props = defineProps<{
  flow: WorkbenchFlow
  cards: WorkbenchFlowCard[]
  counts: WorkbenchFlow['counts']
  pendingIds: string[]
  flash: Record<string, 'moved' | 'failed'>
}>()
const emit = defineEmits<{ move: [card: WorkbenchFlowCard, to: TaskFlowState] }>()

// 宽屏由外层稳定定高，各列独立滚动；1100px 以下显示前 5 条。
const NARROW_LIMIT = 5
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
const rank = (card: WorkbenchFlowCard) => { const level = staleLevel(card.status.code, card.lastActivityAt, props.flow.asOf); return level === 'danger' ? 2 : level === 'warn' ? 1 : 0 }
const columns = computed(() => FLOW_STATES.map(code => {
  const status = props.flow.statuses[code]
  // 等我验证排最前；其余按停滞程度、优先级、空闲时间排序，最该处理的在上面。
  const items = props.cards.filter(card => card.status.code === code).sort((a, b) => Number(b.verify) - Number(a.verify)
    || rank(b) - rank(a) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt))
  return { code, status, items, count: props.counts[code], link: requirementListLink({ assignee: 'me', statusId: status.id }) }
}))
const nameOf = (code: TaskFlowState) => props.flow.statuses[code].name
const moveTargets = (card: WorkbenchFlowCard) => TASK_FLOW_STATES.filter(code => code !== card.status.code)

// 760px 以下三列改为可切换的单列（CSS 控制）；拖动时其余两列和「已完成」一起出现在底部。
const narrow = ref(false)
const activeColumn = ref<BingTabValue>('doing')
let narrowQuery: MediaQueryList | undefined
const syncNarrow = () => { narrow.value = Boolean(narrowQuery?.matches) }
onMounted(() => { narrowQuery = matchMedia('(max-width: 760px)'); narrowQuery.addEventListener('change', syncNarrow); syncNarrow() })
onBeforeUnmount(() => narrowQuery?.removeEventListener('change', syncNarrow))
const tabItems = computed(() => columns.value.map(column => ({ value: column.code, label: `${column.status.name} ${column.count}` })))
const dockTargets = (from: unknown): TaskFlowState[] => narrow.value ? [...FLOW_STATES.filter(code => code !== from), 'done'] : ['done']
// 隐藏的工作流列仍已注册；投放区须用独立 ID，再将落点映射回业务状态。
const dockId = (code: TaskFlowState) => `dock:${code}`

const byId = computed(() => new Map(props.cards.map(card => [card.id, card])))
// 拖到位的卡片由浮层落位交代去向，不再叠加高亮环；菜单移动和撤销仍然高亮。
const landed = ref<string | null>(null)
// 落到底部投放区时卡片离开当前视图：投放区多留一会儿，浮层收进去后播放「收下」效果再退场。
const RECEIVE_MS = 760
const received = ref<{ from: unknown; to: TaskFlowState } | null>(null)
let receiveTimer: ReturnType<typeof setTimeout> | undefined
function onDrop(payload: BingDragDropDropPayload) {
  const card = byId.value.get(String(payload.id))
  const to = TASK_FLOW_STATES.find(code => payload.to === code || payload.to === dockId(code))
  if (!card || !to || card.status.code === to) return
  landed.value = card.id
  setTimeout(() => { if (landed.value === card.id) landed.value = null }, 900)
  if (payload.to === dockId(to)) {
    clearTimeout(receiveTimer)
    received.value = { from: payload.from, to }
    receiveTimer = setTimeout(() => { received.value = null }, RECEIVE_MS)
  }
  emit('move', card, to)
}
onBeforeUnmount(() => clearTimeout(receiveTimer))
const flashOf = (id: string) => props.flash[id] === 'moved' && landed.value === id ? undefined : props.flash[id]
</script>

<template>
  <!-- 落点只看列或投放区，不涉及列内排序；投放区贴着窗口底边，边缘自动滚动只会打乱页面位置。 -->
  <BingDragDrop v-slot="{ active }" :auto-scroll="false" @drop="onDrop">
   <div class="flow-board" :class="{ 'is-dragging': active, 'is-receiving': received }">
    <div class="flow-board__tabs"><BingTabs v-model="activeColumn" :items="tabItems" variant="soft" size="sm" block ariaLabel="切换工作流列" /></div>
    <div class="flow-board__columns">
      <BingDropZone v-for="column in columns" :id="column.code" :key="column.code" tag="section"
        class="flow-column" :class="{ 'is-inactive': column.code !== activeColumn }" :ariaLabel="column.status.name" :style="{ '--status': column.status.color }" :data-flow-column="column.code">
        <header class="flow-column__head">
          <i class="flow-column__dot" aria-hidden="true" />
          <h3>{{ column.status.name }}</h3>
          <NuxtLink :to="column.link" class="flow-column__num" :aria-label="`我负责的${column.status.name} ${column.count} 条，查看列表`">{{ column.count }}</NuxtLink>
        </header>
        <BingScrollbar class="flow-column__scroll" max-height="var(--flow-list-max)" :class="{ 'is-empty': !column.items.length }" :aria-label="`${column.status.name}的文档滚动区`">
          <ul class="flow-column__list" :aria-label="`${column.status.name}的文档`">
            <li v-for="card in column.items" :key="card.id" class="flow-column__entry">
              <BingDraggable :id="card.id" :zone="column.code" :data="card" :disabled="pendingIds.includes(card.id)" class="flow-item"
                :class="{ 'is-pending': pendingIds.includes(card.id), [`is-flash-${flashOf(card.id)}`]: flashOf(card.id) }" :data-flow-card="card.key">
                <WorkflowCard :card="card" :now="flow.asOf">
                  <template #open>
                    <NuxtLink :to="`/requirements/${card.id}`" class="flow-item__open" draggable="false" :aria-label="`打开 ${card.key} ${card.title}`" :aria-describedby="`flow-people-${card.id}`"
                      :title="`${card.title}\n负责人：${card.assignees.map(person => person.name).join('、') || '未指派'}`" @dragstart.prevent />
                  </template>
                  <template #menu>
                    <BingDropDown placement="bottom-end" size="sm" min-width="168px" :ariaLabel="`${card.key} 操作`">
                      <template #trigger="{ triggerProps }">
                        <BingButton v-bind="triggerProps" variant="ghost" size="xs" :throttle="false" :disabled="pendingIds.includes(card.id)"
                          :ariaLabel="`${card.key} 更多操作`" class="flow-item__menu"><BingIcon :icon="Ellipsis" :size="16" decorative /></BingButton>
                      </template>
                      <BingDropDownItem v-for="code in moveTargets(card)" :key="code" :title="`改为${nameOf(code)}`"
                        :tone="code === 'done' ? 'success' : 'default'" @click="emit('move', card, code)" />
                      <BingDropDownItem title="打开文档" :icon="ExternalLink" @click="navigateTo(`/requirements/${card.id}`)" />
                    </BingDropDown>
                  </template>
                </WorkflowCard>
              </BingDraggable>
            </li>
            <li v-if="!column.items.length" class="flow-column__empty"><BingIcon :icon="Inbox" :size="20" decorative />暂无</li>
          </ul>
        </BingScrollbar>
        <NuxtLink v-if="column.items.length > NARROW_LIMIT" :to="column.link" class="flow-column__more">查看全部 {{ column.count }} 条</NuxtLink>
      </BingDropZone>
    </div>
    <p v-if="flow.truncated" class="flow-board__truncated">只显示最久没有进展的 300 条</p>

    <Teleport to="body">
      <Transition name="flow-dock">
        <div v-if="active || received" class="flow-dock-bar">
          <BingDropZone v-for="code in dockTargets(active ? active.zone : received?.from)" :id="dockId(code)" :key="code" class="flow-dock"
            :class="{ 'is-done': code === 'done', 'is-received': !active && received?.to === code, 'is-dimmed': !active && received?.to !== code }" :ariaLabel="nameOf(code)" :style="{ '--status': flow.statuses[code].color }" :data-flow-dock="code">
            <span class="flow-dock__mark" aria-hidden="true"><BingIcon v-if="code === 'done'" :icon="CheckCheck" :size="20" decorative /><i v-else class="flow-dock__dot" /></span>
            <span class="flow-dock__label">{{ nameOf(code) }}</span>
          </BingDropZone>
        </div>
      </Transition>
    </Teleport>
    <BingDragOverlay v-slot="{ data }" class="flow-overlay">
      <WorkflowCard :card="data" :now="flow.asOf" overlay />
    </BingDragOverlay>
   </div>
  </BingDragDrop>
</template>

<style scoped>
.flow-board__tabs { display: none; margin-bottom: 12px; }
.flow-board__columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
/* 静态泳道统一中性底色，只在拖动落点使用状态色。 */
.flow-column {
  --lane: var(--ui-navigation);
  display: flex; flex-direction: column; min-width: 0; min-height: 200px; padding: 0 8px 8px;
  border-radius: 8px; background: var(--lane); outline: 1.5px dashed transparent; outline-offset: -1.5px;
  transition: background-color 160ms ease, outline-color 160ms ease;
}
.flow-column.is-target { outline-color: color-mix(in srgb, var(--status) 45%, transparent); }
.flow-column.is-over { --lane: color-mix(in srgb, var(--status) 12%, var(--ui-navigation)); outline: 2px solid var(--status); outline-offset: -2px; }
.flow-column__head { display: flex; flex: none; align-items: center; gap: 8px; min-height: 40px; padding: 6px 4px 6px 6px; }
.flow-column__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--status); box-shadow: 0 0 0 3px color-mix(in srgb, var(--status) 18%, transparent); }
.flow-column__head h3 { margin: 0; color: var(--bing-heading); font-size: 14px; font-weight: 650; }
.flow-column__num {
  display: inline-grid; place-items: center; min-width: 24px; height: 22px; padding: 0 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--status) 14%, transparent); color: color-mix(in srgb, var(--status) 82%, var(--bing-heading));
  font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; transition: background-color 120ms ease;
}
.flow-column__num:hover { background: color-mix(in srgb, var(--status) 24%, transparent); }
.flow-column__scroll { position: relative; margin: 0 -4px; }
.flow-column__scroll.is-empty { flex: 1; min-height: 120px; }
.flow-column__list { display: grid; align-content: start; gap: 8px; margin: 0; padding: 4px; list-style: none; }
.flow-column__empty { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--bing-muted); font-size: 12px; }
.flow-column__more { align-self: flex-start; margin: 8px 4px 0; padding: 4px 0; color: var(--ui-accent); font-size: 13px; }
.flow-column__more:hover { text-decoration: underline; text-underline-offset: 3px; }
.flow-board__truncated { margin: 8px 4px 0; color: var(--bing-muted); font-size: 12px; }

.flow-item { position: relative; display: block; container-type: inline-size; border-radius: 8px; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.flow-overlay { container-type: inline-size; }
.flow-item__open { position: absolute; inset: 0; z-index: 1; border-radius: inherit; -webkit-user-drag: none; }
.flow-item__open:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.flow-item :deep(.flow-item__menu) { width: 24px; min-width: 24px; padding: 0; color: var(--bing-muted); }
.flow-item:hover :deep(.flow-card) { translate: 0 -1px; border-color: color-mix(in srgb, var(--ui-accent) 32%, var(--bing-border)); box-shadow: 0 6px 16px -8px rgb(15 23 42 / 0.22); }
/* 被拖起的卡片留下同尺寸的空槽，浮层落回时与它重合。 */
.flow-item.is-drag-source :deep(.flow-card) { translate: none; border: 1.5px dashed color-mix(in srgb, var(--bing-muted) 45%, transparent); background: transparent; box-shadow: none; transition: none; }
.flow-item.is-drag-source :deep(.flow-card > *) { visibility: hidden; }
.flow-item.is-pending { cursor: progress; }
.flow-item.is-pending :deep(.flow-card) { opacity: 0.7; }
.flow-item.is-flash-moved :deep(.flow-card) { animation: flow-moved 900ms ease-out; }
.flow-item.is-flash-failed :deep(.flow-card) { animation: flow-failed 420ms ease-in-out; border-color: var(--bing-danger-strong); }
@keyframes flow-moved { from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 40%, transparent); } to { box-shadow: 0 0 0 3px transparent; } }
@keyframes flow-failed { 0%, 100% { translate: 0; } 25% { translate: -4px; } 75% { translate: 4px; } }

.flow-dock-bar { position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom)); z-index: 3990; translate: -50% 0; display: flex; align-items: flex-end; gap: 8px; width: max-content; max-width: calc(100vw - 32px); }
.flow-dock {
  display: flex; align-items: center; justify-content: center; gap: 10px; flex: 1; min-height: 88px; padding: 16px 24px;
  border: 1.5px dashed color-mix(in srgb, var(--status) 55%, transparent); border-radius: 14px;
  background: color-mix(in srgb, var(--status) 7%, var(--bing-surface-solid)); color: color-mix(in srgb, var(--status) 82%, var(--bing-heading));
  font-size: 14px; font-weight: 700; white-space: nowrap;
  box-shadow: 0 18px 40px -18px rgb(15 23 42 / 0.35), 0 0 0 4px color-mix(in srgb, var(--status) 8%, transparent);
  transition: background-color 160ms ease, min-height 180ms ease, min-width 180ms ease;
}
.flow-dock { position: relative; isolation: isolate; }
.flow-dock__mark { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; transition: background-color 160ms ease, color 160ms ease; }
.flow-dock__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--status); }
.flow-dock__label { line-height: 28px; }
/* 收下：浮层收进投放区中心后，区域染满状态色、轻轻一沉，对勾弹出，一道光扫过，外圈荡开。 */
.flow-dock.is-received {
  border-style: solid; border-color: var(--status);
  background: color-mix(in srgb, var(--status) 20%, var(--bing-surface-solid));
  animation: flow-dock-gulp 460ms 170ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
}
.flow-dock.is-received .flow-dock__mark { background: var(--status); color: var(--bing-surface-solid); box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--status) 70%, transparent); }
.flow-dock.is-received .flow-dock__dot { background: currentColor; }
.flow-dock.is-received .flow-dock__mark { animation: flow-dock-pop 420ms 190ms cubic-bezier(0.34, 1.7, 0.64, 1) both; }
.flow-dock.is-received::before {
  content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
  background: linear-gradient(105deg, transparent 30%, color-mix(in srgb, var(--status) 28%, transparent) 50%, transparent 70%) no-repeat;
  background-size: 220% 100%; animation: flow-dock-sheen 560ms 200ms ease-out both;
}
.flow-dock.is-received::after {
  content: ""; position: absolute; inset: -1.5px; border-radius: 15px; border: 2px solid var(--status); pointer-events: none;
  animation: flow-dock-ripple 620ms 190ms ease-out both;
}
.flow-dock.is-dimmed { opacity: 0.45; scale: 0.97; transition: opacity 160ms ease, scale 160ms ease; }
@keyframes flow-dock-gulp { 0% { scale: 1.03; } 30% { scale: 0.96; } 100% { scale: 1; } }
@keyframes flow-dock-pop { 0% { scale: 0.5; rotate: -14deg; } 100% { scale: 1; rotate: 0deg; } }
@keyframes flow-dock-sheen { from { background-position: 120% 0; } to { background-position: -20% 0; } }
@keyframes flow-dock-ripple { from { inset: -1.5px; opacity: 0.7; } to { inset: -14px; border-radius: 26px; opacity: 0; } }
/* 拖入后真正扩大投放范围并向上展开，标题留在上沿，避免被拖动卡片遮住。 */
.flow-dock.is-done { min-width: min(440px, calc(100vw - 32px)); }
.flow-dock:is(.is-over, .is-received) { min-height: 132px; align-items: flex-start; }
.flow-dock.is-done:is(.is-over, .is-received) { min-width: min(560px, calc(100vw - 32px)); }
.flow-dock.is-over { border-style: solid; background: color-mix(in srgb, var(--status) 16%, var(--bing-surface-solid)); }
.flow-dock-enter-from, .flow-dock-leave-to { opacity: 0; transform: translateY(16px); }
.flow-dock-enter-active, .flow-dock-leave-active { transition: opacity 160ms ease, transform 160ms ease; }

/* 高度由外层网格分配，超出的卡片只在列内滚动。 */
@media (min-width: 1101px) {
  .flow-board { display: flex; flex-direction: column; min-height: 0; }
  .flow-board__columns { flex: 1; min-height: 0; }
  .flow-column { min-height: 0; overflow: hidden; }
  .flow-column__scroll { flex: 1; min-height: 0; }
  .flow-column__list { padding-bottom: 8px; }
  .flow-column__more { display: none; }
}
@media (max-width: 1100px) {
  .flow-board { --flow-list-max: none; }
  .flow-column__entry:nth-child(n + 6) { display: none; }
}
@container workbench (max-width: 1000px) {
  .flow-board { --flow-list-max: none; }
  .flow-column { min-height: 200px; }
  .flow-column__entry:nth-child(n + 6) { display: none; }
  .flow-column__more { display: inline-flex; }
}
@media (max-width: 760px) {
  .flow-board__tabs { display: block; }
  .flow-board__columns { grid-template-columns: minmax(0, 1fr); }
  .flow-column.is-inactive { display: none; }
  .flow-column { min-height: 160px; }
  .flow-dock-bar { width: calc(100vw - 32px); }
  .flow-dock { flex-direction: column; justify-content: flex-start; gap: 4px; min-width: 0; padding: 12px 8px; }
  .flow-dock.is-done, .flow-dock.is-done:is(.is-over, .is-received) { min-width: 0; }
  .flow-dock:is(.is-over, .is-received) { flex-direction: row; justify-content: center; align-items: flex-start; }
  .flow-dock__mark { flex: none; width: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .flow-column, .flow-dock { transition: none; }
  .flow-dock-enter-active, .flow-dock-leave-active { transition: none; }
  .flow-dock.is-received, .flow-dock.is-received .flow-dock__mark, .flow-dock.is-received::before, .flow-dock.is-received::after { animation: none; }
  .flow-dock.is-received::before, .flow-dock.is-received::after { display: none; }
  .flow-item:hover :deep(.flow-card) { translate: none; }
  .flow-item.is-flash-moved :deep(.flow-card) { animation: none; outline: 2px solid var(--ui-accent); outline-offset: 1px; }
  .flow-item.is-flash-failed :deep(.flow-card) { animation: none; }
}
@media (pointer: coarse) { .flow-item :deep(.flow-item__menu) { width: 44px; min-height: 44px; } }
</style>
