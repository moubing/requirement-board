import { computed } from 'vue'
import type { RequirementPage, RequirementPageQuery } from '#shared/requirements/query'
import { useRequirementQuery } from './use-requirement-query'

export function usePagedRequirements(key: string, initial: RequirementPageQuery, enabled?: () => boolean) {
  const request = useRequestFetch()
  const result = useRequirementQuery({ key, initial, enabled, fetch: async (query, signal) => {
    let data = await request<RequirementPage>('/api/requirements', { query, signal, retry: 0, timeout: 10_000 })
    const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
    if (query.page > lastPage && data.total > 0) {
      query = { ...query, page: lastPage }
      data = await request<RequirementPage>('/api/requirements', { query, signal, retry: 0, timeout: 10_000 })
    }
    if (!data.total) data = { ...data, page: 1 }
    return { data, query: { ...query, page: data.page, pageSize: data.pageSize } }
  }, receive: data => result.cache.remember(data.items) })
  return { ...result, items: computed(() => (result.data.value?.items ?? []).map(result.cache.title)) }
}
