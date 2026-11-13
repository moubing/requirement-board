import { computed, watch } from 'vue'
import type { BoardMeta } from '~/types/requirement-board'

interface MetaState { scope: string; data: BoardMeta | null; pending: boolean; error: string; updatedAt: number }
const requests = new WeakMap<object, { controller: AbortController; promise: Promise<void> }>()

/** 全局新建与列表共用元数据；不为导航入口加载文档列表。 */
export function useBoardMeta() {
  const app = useNuxtApp()
  const access = useAccountAccessState()
  const request = useRequestFetch()
  const scope = computed(() => access.value?.canAccessProject ? `${access.value.user.id}:project_main` : '')
  const state = useState<MetaState>('board-meta-state', () => ({ scope: '', data: null, pending: false, error: '', updatedAt: 0 }))
  watch(scope, value => {
    if (state.value.scope === value) return
    requests.get(app)?.controller.abort()
    requests.delete(app)
    state.value = { scope: value, data: null, pending: false, error: '', updatedAt: 0 }
  }, { immediate: true, flush: 'sync' })

  async function refresh(force = false): Promise<void> {
    if (!scope.value || (!force && state.value.data && Date.now() - state.value.updatedAt < 60_000)) return
    const existing = requests.get(app)
    if (existing) return existing.promise
    const identity = scope.value
    const controller = new AbortController()
    const current = () => state.value.scope === identity && !controller.signal.aborted
    state.value.pending = true
    const promise = (async () => {
      try {
        const data = await request<BoardMeta>('/api/meta', { signal: controller.signal, retry: 0, timeout: 10_000 })
        if (!current()) return
        state.value.data = data
        state.value.updatedAt = Date.now()
        state.value.error = ''
      } catch (cause) {
        if (!current()) return
        const status = (cause as { statusCode?: number }).statusCode
        if (status === 401 || status === 403) state.value.data = null
        state.value.error = '文档选项加载失败，请重试。'
      } finally {
        if (current()) state.value.pending = false
        if (requests.get(app)?.controller === controller) requests.delete(app)
      }
    })()
    requests.set(app, { controller, promise })
    return promise
  }
  return { scope, data: computed(() => state.value.data), pending: computed(() => state.value.pending), error: computed(() => state.value.error), refresh }
}
