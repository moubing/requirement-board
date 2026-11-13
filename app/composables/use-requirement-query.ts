import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useRequirementCache } from './use-requirement-cache'

export function requirementQueryKey(query: object) {
  return JSON.stringify(Object.entries(query).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
}

/** 成功结果与待请求条件分开；同条件失效顺序补读，切换条件才取消请求。 */
export function useRequirementQuery<Q extends object, R>(options: {
  key: string
  initial: Q
  enabled?: () => boolean
  fetch: (query: Q, signal: AbortSignal) => Promise<{ data: R; query: Q }>
  receive?: (data: R) => void
}) {
  const cache = useRequirementCache()
  const session = cache.session(options.key, () => ({ data: null as R | null, committed: options.initial, target: options.initial }))
  const pending = ref(false)
  const pendingQuery = shallowRef<Q | null>(null)
  const error = ref('')
  let sequence = 0
  let active: { key: string; controller: AbortController; promise: Promise<void> } | undefined
  const enabled = () => Boolean(cache.scope.value && (options.enabled?.() ?? true))
  const query = computed(() => pendingQuery.value ?? session.value.committed)
  function cancel() {
    sequence++; active?.controller.abort(); active = undefined
    pending.value = false; pendingQuery.value = null
  }
  function commit(data: R, next: Q, fresh = true) {
    if (fresh) options.receive?.(data)
    session.value = { data, committed: next, target: next }
    error.value = ''
  }
  async function load(next: Q = session.value.target, force = false): Promise<void> {
    if (!enabled()) return
    const key = `${cache.scope.value}:${options.key}:${requirementQueryKey(next)}`
    if (active?.key === key) return active.promise
    cancel()
    const identity = cache.scope.value, request = sequence
    const controller = new AbortController()
    const current = () => request === sequence && identity === cache.scope.value && !controller.signal.aborted
    session.value.target = { ...next }
    error.value = ''
    const cached = !force && cache.read(key)
    if (cached) { commit(cached.data as R, cached.query as Q, false); return }
    pending.value = true; pendingQuery.value = { ...next }
    const promise = (async () => {
      try {
        while (current()) {
          const generation = cache.state.value.generation
          try {
            const result = await options.fetch({ ...next }, controller.signal)
            if (!current()) return
            if (generation !== cache.state.value.generation) continue
            cache.write(key, result.data, result.query)
            commit(result.data, result.query)
          } catch (cause) {
            if (!current()) return
            if (generation !== cache.state.value.generation) continue
            const status = (cause as { statusCode?: number; status?: number }).statusCode ?? (cause as { status?: number }).status
            if (status === 401 || status === 403) cache.clearAccess()
            error.value = status === 401 || status === 403 ? '登录或项目访问权限已失效。' : '暂时无法加载，请重试。已保留上次成功的结果。'
          }
          return
        }
      } finally {
        if (current()) { pending.value = false; pendingQuery.value = null; active = undefined }
      }
    })()
    active = { key, controller, promise }
    return promise
  }
  watch(() => cache.state.value.authorizationEpoch, () => { cancel(); error.value = '' }, { flush: 'sync' })
  watch([() => cache.state.value.generation, () => cache.state.value.authorizationEpoch], ([_generation, epoch], [_previous, previousEpoch]) => {
    if (epoch === previousEpoch && enabled()) void load(session.value.target, true)
  })
  watch(() => options.enabled?.() ?? true, value => { if (!value) cancel() })
  const onFocus = () => { if (enabled()) void load(session.value.target, true) }
  onMounted(() => window.addEventListener('focus', onFocus))
  onScopeDispose(() => { cancel(); if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus) })
  return { cache, data: computed(() => session.value.data), committedQuery: computed(() => session.value.committed),
    targetQuery: computed(() => session.value.target), query, pendingQuery, pending, error, load, cancel,
    refresh: () => load(session.value.target, true), retry: () => load(session.value.target, true) }
}
