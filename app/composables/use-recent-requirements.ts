import { emptyRecentRequirements, mergeRecentRequirements, parseRecentRequirements, type RecentRequirementsRecord } from '../utils/recent-requirements'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRequirementCache } from './use-requirement-cache'
import { useRequirementQuery } from './use-requirement-query'
import type { RequirementSummariesResult } from '#shared/requirements/query'

export function useRecentRequirements(active: () => boolean = () => false) {
  const cache = useRequirementCache()
  const request = useRequestFetch()
  const record = useState<RecentRequirementsRecord>('recent-requirements', emptyRecentRequirements)
  const owner = useState('recent-requirements-owner', () => '')
  const key = computed(() => cache.scope.value ? `rb:recent-requirements:v1:${cache.scope.value}` : '')
  let mounted = false
  function read() {
    try { return parseRecentRequirements(key.value ? localStorage.getItem(key.value) : null) }
    catch { return emptyRecentRequirements() }
  }
  function persist() {
    if (!mounted || !key.value) return
    try { localStorage.setItem(key.value, JSON.stringify(record.value)) } catch { /* 当前会话仍可使用。 */ }
  }
  function load() {
    if (owner.value !== key.value) { record.value = emptyRecentRequirements(); owner.value = key.value }
    if (mounted && key.value) record.value = mergeRecentRequirements(record.value, read())
  }
  watch(key, load, { immediate: true, flush: 'sync' })
  function storage(event: StorageEvent) {
    if (event.key !== key.value) return
    const merged = mergeRecentRequirements(record.value, parseRecentRequirements(event.newValue))
    record.value = merged
    // 合并后回写收敛并发访问；相同内容不写，避免多个标签页互相触发事件。
    if (JSON.stringify(merged) !== event.newValue) persist()
  }
  onMounted(() => { mounted = true; load(); window.addEventListener('storage', storage) })
  onBeforeUnmount(() => window.removeEventListener('storage', storage))
  const entries = computed(() => record.value.entries)
  const summaries = useRequirementQuery({ key: 'recent:summaries', initial: { ids: [] as string[] }, enabled: () => active() && Boolean(entries.value.length),
    fetch: async (query, signal) => ({ data: await request<RequirementSummariesResult>('/api/requirements/summaries', { query, signal, retry: 0, timeout: 10_000 }), query }),
    receive: result => {
      cache.remember(result.items)
      if (!result.complete) return
      const requested = new Set(result.requestedIds)
      const unavailable = new Set(result.unavailableIds.filter(id => requested.has(id)))
      record.value = { ...record.value, entries: entries.value.filter(entry => !unavailable.has(entry.id)) }
      persist()
    },
  })
  const refresh = (force = false) => entries.value.length ? summaries.load({ ids: entries.value.map(entry => entry.id) }, force) : Promise.resolve()
  watch([active, () => entries.value.map(entry => entry.id).join(',')], () => { if (active()) void refresh() })
  const items = computed(() => entries.value.flatMap(entry => {
    const item = cache.state.value.summaries[entry.id]
    return item ? [{ ...cache.title(item), visitedAt: entry.visitedAt }] : []
  }))
  function visit(id: string) {
    if (!mounted || !key.value) return
    record.value = mergeRecentRequirements(mergeRecentRequirements(record.value, read()), {
      version: 1, clearedAt: 0, entries: [{ id, visitedAt: Math.max(Date.now(), record.value.clearedAt + 1) }],
    })
    persist()
  }
  function clear() {
    record.value = { version: 1, clearedAt: Math.max(Date.now(), ...record.value.entries.map(item => item.visitedAt)), entries: [] }
    persist()
  }
  return { entries, items, visit, clear, refresh, pending: summaries.pending, error: summaries.error }
}
