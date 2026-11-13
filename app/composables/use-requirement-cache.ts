import { computed, watch } from 'vue'
import type { RequirementSummary } from '#shared/requirements/query'

interface QueryEntry { data: unknown; query: unknown; at: number; generation: number }
interface RequirementCacheState {
  scope: string
  generation: number
  authorizationEpoch: number
  summaries: Record<string, RequirementSummary>
  titles: Record<string, string>
  queries: Record<string, QueryEntry>
  sessions: Record<string, unknown>
}
const empty = (scope = '', authorizationEpoch = 0): RequirementCacheState => ({
  scope, authorizationEpoch, generation: 0, summaries: {}, titles: {}, queries: {}, sessions: {},
})

/** 摘要及有边界的查询缓存；任何集合都不代表项目中的全部文档。 */
export function useRequirementCache() {
  const access = useAccountAccessState()
  const state = useState<RequirementCacheState>('requirement-cache', () => empty())
  const scope = computed(() => access.value?.canAccessProject ? `${access.value.user.id}:project_main` : '')
  watch(scope, value => {
    if (state.value.scope !== value) state.value = empty(value, state.value.authorizationEpoch + 1)
  }, { immediate: true, flush: 'sync' })
  function remember(items: RequirementSummary[]) {
    for (const item of items) {
      const previous = state.value.summaries[item.id]
      if (previous && Date.parse(previous.updatedAt) > Date.parse(item.updatedAt)) continue
      state.value.summaries[item.id] = item
      delete state.value.titles[item.id]
    }
    const ids = Object.keys(state.value.summaries)
    for (const id of ids.slice(0, Math.max(0, ids.length - 1000))) delete state.value.summaries[id]
  }
  return {
    state, scope, remember,
    invalidate() { state.value.generation++ },
    clearAccess() { state.value = empty(scope.value, state.value.authorizationEpoch + 1) },
    setTitle(id: string, title: string) { state.value.titles[id] = title },
    title<T extends { id: string; title: string }>(item: T): T { return { ...item, title: state.value.titles[item.id] ?? state.value.summaries[item.id]?.title ?? item.title } },
    session<T>(key: string, init: () => T) {
      return computed<T>({
        get: () => (state.value.sessions[key] ??= init()) as T,
        set: value => { state.value.sessions[key] = value },
      })
    },
    read(key: string) {
      const entry = state.value.queries[key]
      return entry && entry.generation === state.value.generation && Date.now() - entry.at < 60_000 ? entry : undefined
    },
    write(key: string, data: unknown, query: unknown) {
      state.value.queries[key] = { data, query, at: Date.now(), generation: state.value.generation }
      const keys = Object.keys(state.value.queries)
      for (const old of keys.slice(0, Math.max(0, keys.length - 100))) delete state.value.queries[old]
    },
  }
}
