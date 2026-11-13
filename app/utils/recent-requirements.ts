export interface RecentRequirement { id: string; visitedAt: number }
export interface RecentRequirementsRecord { version: 1; clearedAt: number; entries: RecentRequirement[] }
export const emptyRecentRequirements = (): RecentRequirementsRecord => ({ version: 1, clearedAt: 0, entries: [] })

export function parseRecentRequirements(raw: string | null): RecentRequirementsRecord {
  try {
    const data: unknown = JSON.parse(raw ?? 'null')
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1
      || !('entries' in data) || !Array.isArray(data.entries)) return emptyRecentRequirements()
    const clearedAt = 'clearedAt' in data && typeof data.clearedAt === 'number' && Number.isFinite(data.clearedAt) ? data.clearedAt : 0
    const entries = data.entries.filter((item): item is RecentRequirement => Boolean(item && typeof item.id === 'string'
      && item.id.length <= 200 && typeof item.visitedAt === 'number' && Number.isFinite(item.visitedAt) && item.visitedAt > clearedAt))
      .map(({ id, visitedAt }) => ({ id, visitedAt }))
    return mergeRecentRequirements({ version: 1, clearedAt, entries }, emptyRecentRequirements())
  } catch { return emptyRecentRequirements() }
}

export function mergeRecentRequirements(left: RecentRequirementsRecord, right: RecentRequirementsRecord): RecentRequirementsRecord {
  const clearedAt = Math.max(left.clearedAt, right.clearedAt)
  const entries = new Map<string, RecentRequirement>()
  for (const item of [...left.entries, ...right.entries]) {
    if (item.visitedAt > clearedAt && item.visitedAt > (entries.get(item.id)?.visitedAt ?? 0)) entries.set(item.id, item)
  }
  return { version: 1, clearedAt, entries: [...entries.values()].sort((a, b) => b.visitedAt - a.visitedAt || a.id.localeCompare(b.id)).slice(0, 20) }
}
