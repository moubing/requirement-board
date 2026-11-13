/** 首页数字和格子跳到带筛选的文档列表；参数与 requirementFilterSchema 一致，由列表页从地址读取。 */
export type RequirementListFilters = { assignee?: string; reporter?: string; statusId?: string; stale?: '1'; documentType?: string }

export function requirementListLink(filters: RequirementListFilters) {
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])))
  return `/requirements${query.size ? `?${query}` : ''}`
}
