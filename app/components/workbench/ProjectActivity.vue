<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { BingButton, BingIcon, BingScrollbar, BingTabs, type BingScrollbarExpose, type BingTabValue } from '@moubing/bing-ui'
import { LoaderCircle } from 'lucide-vue-next'
import { useRequirementCache } from '~/composables/use-requirement-cache'
import { ACTIVITY_FILTER_LABELS, ACTIVITY_FILTERS, shanghaiDate, shiftDay, type ActivityFilter, type WorkbenchActivityEvent, type WorkbenchActivityPage } from '#shared/workbench/home'

defineProps<{ maxHeight: string | number }>()
const cache = useRequirementCache()
const filters = ACTIVITY_FILTERS.map(value => ({ value, label: ACTIVITY_FILTER_LABELS[value] }))
const filter = cache.session<BingTabValue>('workbench:activity:filter', () => 'all')
const items = ref<WorkbenchActivityEvent[]>([])
const cursor = ref<string | null>(null)
const asOf = ref<string | null>(null)
const loadingMode = ref<'reset' | 'more' | null>(null)
const loading = computed(() => loadingMode.value !== null)
const refreshing = computed(() => loadingMode.value === 'reset')
const showLoading = ref(false)
const showMoreLoading = computed(() => showLoading.value && loadingMode.value === 'more')
const loaded = ref(false)
const error = ref('')
const retryReset = ref(true)
const scrollbar = ref<BingScrollbarExpose | null>(null)
let displayedFilter: BingTabValue | null = null
let sequence = 0, controller: AbortController | undefined

// 快请求不显示加载提示；同类连续请求沿用等待，分页切换为刷新时重新计时。
watch(loadingMode, (mode, _previous, onCleanup) => {
  showLoading.value = false
  if (!mode) return
  const timer = setTimeout(() => { showLoading.value = true }, 150)
  onCleanup(() => clearTimeout(timer))
})

/** 首屏或筛选、失效后从头读取；加载更早只追加，失败保留已显示的部分。 */
async function load(reset: boolean) {
  if (!cache.scope.value || (!reset && (!cursor.value || loading.value))) return
  const request = ++sequence, scope = cache.scope.value, kind = filter.value
  controller?.abort(); controller = new AbortController()
  if (reset) scrollbar.value?.stop()
  loadingMode.value = reset ? 'reset' : 'more'; error.value = ''
  try {
    const page = await $fetch<WorkbenchActivityPage>('/api/workbench/activity', { signal: controller.signal, retry: 0, timeout: 10_000,
      query: { kind, limit: 30, ...(reset || !cursor.value ? {} : { cursor: cursor.value }) } })
    if (request !== sequence || scope !== cache.scope.value) return
    items.value = reset ? page.items : [...items.value, ...page.items.filter(item => !items.value.some(old => old.id === item.id))]
    cursor.value = page.nextCursor; asOf.value = reset ? page.asOf : asOf.value ?? page.asOf; loaded.value = true
    const changedFilter = displayedFilter !== kind
    displayedFilter = kind
    // 筛选成功后才回到顶部；等待期间和同筛选刷新保留阅读位置。
    if (reset && changedFilter) {
      await nextTick()
      if (request === sequence && scope === cache.scope.value) scrollbar.value?.scrollTo({ top: 0, behavior: 'instant' })
    }
  } catch (cause) {
    if (request !== sequence || (cause as Error).name === 'AbortError') return
    retryReset.value = reset
    error.value = reset ? (items.value.length ? '动态刷新失败，已保留上次内容。' : '动态暂时无法加载。') : '更早的动态暂时无法加载。'
  } finally {
    if (request === sequence) loadingMode.value = null
  }
}
watch(filter, () => { void load(true) })
watch(() => cache.state.value.generation, () => { void load(true) })
watch(() => cache.scope.value, () => {
  // 仅同一账号/项目保留旧内容，作用域变化必须立即清空。
  sequence++; controller?.abort(); loadingMode.value = null; error.value = ''
  items.value = []; cursor.value = null; asOf.value = null; loaded.value = false; displayedFilter = null
  void load(true)
})
onMounted(() => { void load(true) })
onScopeDispose(() => { sequence++; controller?.abort() })

const today = computed(() => shanghaiDate(asOf.value ?? new Date()))
const groups = computed(() => {
  const yesterday = shiftDay(today.value, -1)
  const result: Array<{ label: string; items: WorkbenchActivityEvent[] }> = []
  for (const item of items.value) {
    const date = shanghaiDate(item.at)
    const label = date === today.value ? '今天' : date === yesterday ? '昨天' : '更早'
    if (result.at(-1)?.label !== label) result.push({ label, items: [] })
    result.at(-1)!.items.push(item)
  }
  return result
})
function clock(item: WorkbenchActivityEvent) {
  const date = shanghaiDate(item.at)
  if (date >= shiftDay(today.value, -1)) return new Date(item.at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date.slice(0, 4) === today.value.slice(0, 4) ? '' : `${date.slice(0, 4)}年`}${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
}
const names = (list: { name: string }[] = []) => list.map(item => item.name).join('、')

// 提前一屏预取下一页，矮视口至少留 240px；按钮保留给键盘和读屏用户。
function onScroll(event: Event) {
  const viewport = event.currentTarget as HTMLElement | null
  if (!viewport || !viewport.clientHeight || error.value) return
  const preloadDistance = Math.max(240, viewport.clientHeight)
  const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  if (remaining <= preloadDistance) void load(false)
}
</script>

<template>
  <div class="activity">
    <BingTabs v-model="filter" :items="filters" variant="soft" size="sm" ariaLabel="筛选动态类型" class="activity__filters" />
    <div class="activity__content">
    <BingScrollbar ref="scrollbar" :max-height="maxHeight" aria-label="全项目动态" class="activity__scroll" :aria-busy="loading" :inert="refreshing" @scroll="onScroll">
      <div v-for="group in groups" :key="group.label" class="activity__group">
        <h3 class="activity__day">{{ group.label }}</h3>
        <ol class="activity__list">
          <li v-for="item in group.items" :key="item.id">
            <NuxtLink :to="`/requirements/${item.document.id}`" class="activity__item" :class="{ 'is-mine': item.mine }" :data-activity-kind="item.kind">
              <span class="activity__avatar" :style="{ '--avatar': item.actor.avatarColor }" aria-hidden="true">{{ Array.from(item.actor.name)[0] }}</span>
              <span class="activity__body">
                <span class="activity__line">
                  <strong>{{ item.actor.name }}</strong>
                  <template v-if="item.kind === 'create'">新建了</template>
                  <template v-else-if="item.kind === 'revision'">保存了正式版本 v{{ item.version }}</template>
                  <template v-else-if="item.kind === 'assignee'">{{ item.assignees?.length ? `指派给 ${names(item.assignees)}` : '取消了负责人' }}</template>
                  <template v-else-if="item.kind === 'priority'">将优先级 {{ item.from?.label }} → <b>{{ item.to?.label }}</b></template>
                  <template v-else>
                    <span class="activity__status" :style="{ '--status': item.from?.color ?? 'var(--bing-muted)' }">{{ item.from?.label }}</span>
                    <span aria-hidden="true">→</span><span class="visually-hidden">改为</span>
                    <span class="activity__status is-to" :style="{ '--status': item.to?.color ?? 'var(--bing-muted)' }">{{ item.to?.label }}</span>
                  </template>
                </span>
                <span class="activity__doc"><span class="activity__key">{{ item.document.key }}</span>{{ item.document.title }}</span>
              </span>
              <span class="activity__meta">
                <time class="activity__time" :datetime="item.at">{{ clock(item) }}</time>
              </span>
              <span v-if="item.mine" class="visually-hidden">，与我有关</span>
            </NuxtLink>
          </li>
        </ol>
      </div>
      <p v-if="loaded && !items.length && !error" class="activity__empty">暂无动态</p>
      <div class="activity__more">
        <template v-if="error"><span role="alert">{{ error }}</span><BingButton variant="secondary" size="sm" :loading="loading" @click="load(retryReset)">重试</BingButton></template>
        <span v-else-if="showMoreLoading" class="activity__more-loading" role="status" aria-live="polite"><BingIcon :icon="LoaderCircle" :size="16" decorative class="activity__spinner" />正在加载更早的动态…</span>
        <span v-else-if="loaded && !cursor && items.length">已经到底了</span>
        <BingButton v-else-if="cursor" variant="ghost" size="sm" :disabled="loading" @click="load(false)">加载更早的动态</BingButton>
      </div>
    </BingScrollbar>
    <Transition name="activity-loading">
      <div v-if="showLoading && refreshing" class="activity__loading" role="status" aria-live="polite" :aria-hidden="!refreshing">
        <span class="activity__loading-label"><BingIcon :icon="LoaderCircle" :size="18" decorative class="activity__spinner" />正在加载动态…</span>
      </div>
    </Transition>
    </div>
  </div>
</template>

<style scoped>
.activity { display: flex; flex-direction: column; min-height: 0; }
.activity__content { position: relative; display: flex; flex: 1; min-height: 140px; }
.activity__scroll { flex: 1; min-width: 0; min-height: 0; }
.activity__filters { margin: 0 4px 8px 0; }
.activity__loading { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; border-radius: 8px; background: color-mix(in srgb, var(--bing-surface-solid) 72%, transparent); cursor: progress; }
.activity-loading-enter-active, .activity-loading-leave-active { transition: opacity 100ms ease; }
.activity-loading-enter-from, .activity-loading-leave-to { opacity: 0; }
.activity-loading-leave-active { pointer-events: none; }
.activity__loading-label { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: var(--bing-surface-solid); color: var(--bing-muted); font-size: 12px; }
.activity__spinner { color: var(--ui-accent); animation: activity-spin 900ms linear infinite; }
@keyframes activity-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .activity__spinner { animation: none; }
  .activity-loading-enter-active, .activity-loading-leave-active { transition: none; }
}
.activity__group + .activity__group { margin-top: 8px; }
.activity__day { position: sticky; top: 0; z-index: 1; margin: 0; padding: 6px 8px 4px; background: var(--bing-surface-solid); color: var(--bing-muted); font-size: 12px; font-weight: 500; }
.activity__list { margin: 0; padding: 0; list-style: none; }
.activity__item {
  position: relative; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: start; gap: 8px;
  padding: 6px 8px; border-radius: 6px; color: var(--bing-text); font-size: 12px;
}
.activity__item.is-mine::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 2px; border-radius: 2px; background: var(--ui-accent); }
.activity__item:hover { background: color-mix(in srgb, var(--bing-heading) 5%, transparent); }
.activity__item:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.activity__meta { display: flex; align-items: center; gap: 6px; padding-top: 2px; }
.activity__avatar { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--avatar, var(--bing-muted)); color: #fff; font-size: 11px; font-weight: 700; }
.activity__body { display: grid; gap: 2px; min-width: 0; }
.activity__line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; color: var(--bing-muted); }
.activity__line strong { color: var(--bing-heading); font-weight: 600; }
.activity__line b { color: var(--bing-heading); }
.activity__status { padding: 0 6px; border-radius: 4px; background: color-mix(in srgb, var(--status) 10%, transparent); color: var(--bing-muted); font-size: 12px; line-height: 20px; }
.activity__status.is-to { color: var(--status); font-weight: 600; }
.activity__doc { overflow: hidden; color: var(--bing-heading); text-overflow: ellipsis; white-space: nowrap; }
.activity__key { margin-right: 6px; color: var(--bing-muted); font-variant-numeric: tabular-nums; }
.activity__time { color: var(--bing-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.activity__empty { margin: 24px 0; color: var(--bing-muted); font-size: 13px; text-align: center; }
.activity__more { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; min-height: 40px; align-items: center; color: var(--bing-muted); font-size: 12px; }
.activity__more-loading { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; }
</style>
