<script setup lang="ts">
import { BingAutocomplete, BingButton, BingIcon } from '@moubing/bing-ui'
import type { BingAutocompleteExpose, BingAutocompleteOption } from '@moubing/bing-ui'
import { ExternalLink, Search, X } from 'lucide-vue-next'
import RecentRequirementsMenu from './RecentRequirementsMenu.vue'
import { useRequirementCache } from '~/composables/use-requirement-cache'
import { useRequirementQuery } from '~/composables/use-requirement-query'
import type { RequirementSearchQuery, RequirementSearchResult } from '#shared/requirements/query'

const route = useRoute()
const router = useRouter()
const index = useRequirementCache()
const recentOpen = ref(false)
const recent = useRecentRequirements(() => recentOpen.value)
const workspace = useRequirementWorkspace()
const autocomplete = ref<BingAutocompleteExpose | null>(null)
const searchRoot = ref<HTMLElement | null>(null)
const switcher = ref<HTMLElement | null>(null)
const query = ref('')
const expanded = ref(false)
const searchShortcut = ref('Ctrl K')
const navigating = ref(false)
const error = ref('')
const currentId = computed(() => /^\/requirements\/[^/]+\/?$/.test(route.path) ? String(route.params.id ?? '') : '')
const disabled = computed(() => navigating.value || workspace.value.locked)
const request = useRequestFetch()
const search = useRequirementQuery<RequirementSearchQuery, RequirementSearchResult>({ key: 'header:search',
  initial: { q: '', recentIds: [], limit: 20 }, enabled: () => expanded.value && Boolean(query.value.trim()),
  fetch: async (query, signal) => ({ data: await request<RequirementSearchResult>('/api/requirements/search', { query, signal, retry: 0, timeout: 10_000 }), query }),
  receive: data => index.remember(data.items),
})
const candidates = computed(() => query.value.trim() && query.value.trim() === search.committedQuery.value.q
  ? (search.data.value?.items ?? []).map(index.title) : [])
let queryTimer: ReturnType<typeof setTimeout> | undefined
function refreshSearch(force = false) {
  clearTimeout(queryTimer)
  if (!query.value.trim()) { search.cancel(); return }
  return search.load({ q: query.value.trim(), recentIds: recent.entries.value.map(item => item.id), limit: 20 }, force)
}
watch(query, () => {
  clearTimeout(queryTimer)
  search.cancel()
  if (query.value.trim()) queryTimer = setTimeout(() => { void refreshSearch() }, 160)
})
watch(expanded, value => { if (value) void refreshSearch(); else { clearTimeout(queryTimer); search.cancel() } })
const options = computed<BingAutocompleteOption[]>(() => candidates.value.map(item => ({
  value: item.id, label: `${item.key}（${item.title}）`,
  meta: { 状态: item.status.name, 优先级: { low: '低', medium: '中', high: '高' }[item.priority],
    负责人: item.assignees.map(user => user.name).join('、') || '未指派', 报告人: item.reporter.name,
    更新时间: new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) },
})))
let composing = false
let disposed = false

async function focusSearch() {
  if (disabled.value) return
  recentOpen.value = false
  expanded.value = true
  await nextTick(); autocomplete.value?.focus()
}
function searchOpened() { expanded.value = true; recentOpen.value = false; error.value = '' }
watch(recentOpen, value => { if (value) { autocomplete.value?.close(); expanded.value = false; error.value = ''; void recent.refresh() } })
function collapseSearch(restoreFocus = false) {
  expanded.value = false; autocomplete.value?.close()
  const toggle = switcher.value?.querySelector<HTMLButtonElement>('[data-search-toggle]')
  if (restoreFocus && toggle?.getClientRects().length) toggle.focus({ preventScroll: true })
}
function searchClosed() {
  // 清空时只关闭候选，窄屏仍保留输入框，方便继续搜索。
  if (query.value.trim() || document.activeElement !== autocomplete.value?.input) expanded.value = false
}
async function searchBlurred() {
  await nextTick()
  if (!query.value.trim() && !searchRoot.value?.contains(document.activeElement)) collapseSearch()
}
function searchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !expanded.value || event.isComposing || composing || event.keyCode === 229) return
  event.preventDefault(); event.stopPropagation(); collapseSearch(true)
}
watch(() => route.fullPath, () => {
  collapseSearch(); recentOpen.value = false; error.value = ''
})
function openInNewTab(id: string) {
  if (disabled.value) return
  window.open(router.resolve(`/requirements/${encodeURIComponent(id)}`).href, '_blank', 'noopener,noreferrer')
}
async function select(id: string) {
  if (disabled.value) return
  const target = `/requirements/${encodeURIComponent(id)}`
  if (id === currentId.value) { autocomplete.value?.close(); recentOpen.value = false; return }
  navigating.value = true; error.value = ''
  const origin = router.currentRoute.value.fullPath
  const identity = index.scope.value
  try {
    const failure = await router.push(target)
    if (disposed || identity !== index.scope.value) return
    if (failure) { error.value = workspace.value.error || '切换未完成，当前文档已保留，请重试。'; return }
    autocomplete.value?.close(); recentOpen.value = false
  } catch (reason) {
    if (disposed || router.currentRoute.value.fullPath !== origin || identity !== index.scope.value) return
    const code = (reason as { statusCode?: number }).statusCode
    error.value = code === 404 || code === 403 ? '文档已删除或暂时无权访问，请重新搜索。' : '无法打开文档，请检查网络后重试。'
    if (code === 404 || code === 403) index.invalidate()
  } finally { navigating.value = false }
}
async function allResults() {
  if (disabled.value) return
  const target = { path: '/requirements', query: { q: query.value.trim() } }
  if (router.currentRoute.value.fullPath === router.resolve(target).fullPath) { autocomplete.value?.close(); return }
  navigating.value = true
  try {
    const failure = await router.push(target)
    if (failure) error.value = workspace.value.error || '当前修改尚未完整备份，请重试。'
    else autocomplete.value?.close()
  } catch {
    error.value = '暂时无法打开文档列表，请重试。'
  } finally { navigating.value = false }
}
function shortcut(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || event.isComposing || composing
    || document.querySelector('[aria-modal="true"], dialog[open]') || disabled.value) return
  event.preventDefault(); event.stopPropagation(); void focusSearch()
}
const compositionStart = () => { composing = true }
const compositionEnd = () => { composing = false }
onMounted(() => {
  searchShortcut.value = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
  document.addEventListener('keydown', shortcut, true)
  document.addEventListener('compositionstart', compositionStart)
  document.addEventListener('compositionend', compositionEnd)
})
onBeforeUnmount(() => {
  disposed = true; clearTimeout(queryTimer)
  document.removeEventListener('keydown', shortcut, true)
  document.removeEventListener('compositionstart', compositionStart)
  document.removeEventListener('compositionend', compositionEnd)
})
</script>

<template>
  <div ref="switcher" class="requirement-quick-switcher">
    <BingButton class="requirement-search-toggle app-header-control" data-search-toggle variant="ghost" size="lg"
      :disabled="disabled" :throttle="false" aria-label="搜索文档" :aria-expanded="expanded" :title="`搜索文档（${searchShortcut}）`" @click="focusSearch">
      <span class="app-header-button-content"><BingIcon :icon="Search" :size="18" decorative /><span class="requirement-search-label app-header-action-label">搜索文档</span></span>
    </BingButton>
    <div ref="searchRoot" class="requirement-header-search" :class="{ 'is-expanded': expanded }" @focusin="searchOpened" @focusout="searchBlurred" @keydown="searchKeydown">
      <BingAutocomplete ref="autocomplete" v-model="query" :options="options" :filter="false" :open-on-empty="false" :complete-on-select="false" :close-on-select="false"
        :loading="search.pending.value" :error="search.error.value"
        :disabled="workspace.locked" :icon="Search" :panel-width="400" :panel-max-height="380" size="lg" block
        :placeholder="`搜索文档（${searchShortcut}）`" aria-label="搜索文档号或名称" option-action-label="在新标签页打开"
        @open="searchOpened" @close="searchClosed" @select="select(String($event.value))" @option-action="openInNewTab(String($event.value))">
        <template #header>{{ search.data.value?.hasMore ? '前 20 条结果，查看全部可继续检索' : `找到 ${candidates.length} 条文档` }}</template>
        <template #option="{ option }"><span>{{ option.label }}</span><small v-if="option.value === currentId" class="requirement-search-current">当前</small></template>
        <template #option-action><BingIcon :icon="ExternalLink" :size="16" decorative /></template>
        <template #empty>没有匹配的文档，试试其他编号或名称</template>
        <template #error><span>文档暂时无法加载。</span><BingButton variant="ghost" size="sm" :loading="search.pending.value" @click="refreshSearch(true)">重试</BingButton></template>
        <template #footer>
          <p v-if="error" class="requirement-search-error" role="alert">{{ error }}</p>
          <BingButton variant="ghost" size="sm" :disabled="disabled" :loading="navigating" @click="allResults">查看全部搜索结果</BingButton>
        </template>
      </BingAutocomplete>
      <BingButton v-if="expanded" class="requirement-search-collapse" variant="ghost" size="sm" aria-label="关闭搜索" @click="collapseSearch(true)"><BingIcon :icon="X" :size="17" decorative /></BingButton>
    </div>
    <RecentRequirementsMenu v-model:open="recentOpen" :items="recent.items.value" :current-id="currentId" :disabled="disabled"
      :loading="recent.pending.value" :error="error || recent.error.value" @select="select" @clear="recent.clear" @retry="recent.refresh(true)" />
  </div>
</template>
