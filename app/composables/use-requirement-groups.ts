import type { RequirementFilters, RequirementGroups } from '#shared/requirements/query'
import { useRequirementQuery } from './use-requirement-query'

export function useRequirementGroups(initial: RequirementFilters, enabled?: () => boolean) {
  const request = useRequestFetch()
  return useRequirementQuery({ key: 'documents:groups', initial, enabled, fetch: async (query, signal) => ({
    data: await request<RequirementGroups>('/api/requirements/groups', { query, signal, retry: 0, timeout: 10_000 }), query,
  }) })
}
