import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import type { AgentTokenDto, AgentTokenPage, AgentTokenQuery } from '#shared/agent/tokens'

type FetchPage = (query: AgentTokenQuery, signal: AbortSignal) => Promise<AgentTokenPage>
type TokenStatus = Exclude<AgentTokenQuery['status'], 'all'>
export interface AgentTokenOverview {
  counts: Record<TokenStatus, number>
  activeTokens: AgentTokenDto[]
  asOf: string
}

export function useAgentTokenPage(fetchPage: FetchPage = (query, signal) =>
  $fetch<AgentTokenPage>('/api/account/agent-tokens', { query, signal, retry: 0, timeout: 15_000 })) {
  const data = shallowRef<AgentTokenPage | null>(null)
  const overview = shallowRef<AgentTokenOverview | null>(null)
  const committedQuery = shallowRef<AgentTokenQuery>({ page: 1, limit: 10, status: 'active' })
  const pendingQuery = shallowRef<AgentTokenQuery | null>(null)
  const pending = ref(false)
  const error = shallowRef<unknown>(null)
  let lastQuery = committedQuery.value
  let sequence = 0
  let controller: AbortController | undefined
  const query = computed(() => pendingQuery.value ?? committedQuery.value)

  async function load(next: AgentTokenQuery = query.value) {
    const request = ++sequence
    controller?.abort()
    const active = controller = new AbortController()
    lastQuery = { ...next }
    pendingQuery.value = lastQuery
    pending.value = true
    error.value = null
    try {
      let requested = { ...next }
      let result = await fetchPage(requested, active.signal)
      if (request !== sequence) return
      const lastPage = Math.max(1, Math.ceil(result.total / result.limit))
      if (requested.page > lastPage) {
        requested = { ...requested, page: lastPage }
        pendingQuery.value = requested
        result = await fetchPage(requested, active.signal)
        if (request !== sequence) return
      }
      if (result.total === 0) result = { ...result, page: 1 }
      // 复用现有分页接口的 total；不下载全部过期/撤销历史，也不把本页长度当总数。
      const statuses = ['active', 'expired', 'revoked'] as const
      const summaries = await Promise.all(statuses.map(status =>
        requested.status === status && (status !== 'active' || (requested.page === 1 && requested.limit >= 10))
          ? result
          : fetchPage({ page: 1, limit: status === 'active' ? 10 : 1, status }, active.signal)))
      if (request !== sequence) return
      overview.value = { counts: { active: summaries[0]!.total, expired: summaries[1]!.total, revoked: summaries[2]!.total },
        activeTokens: summaries[0]!.items, asOf: summaries[0]!.asOf }
      data.value = result
      committedQuery.value = { ...requested, page: result.page, limit: result.limit }
    } catch (err) {
      if (request === sequence) { error.value = err; active.abort() }
    } finally {
      if (request === sequence) { pending.value = false; pendingQuery.value = null }
    }
  }
  onScopeDispose(() => { sequence++; controller?.abort() })
  return { data, overview, query, committedQuery, pending, error, load, retry: () => load(lastQuery) }
}
