import type { BoardRequirement } from '../types/requirement-board'
import { compareRequirementText, requirementMatchScore } from '#shared/requirements/search'
export { requirementMatchScore }

export function searchRequirements(items: BoardRequirement[], query: string, recent: { id: string; visitedAt: number }[] = []) {
  const visits = new Map(recent.map(item => [item.id, item.visitedAt]))
  return items.map(item => ({ item, score: requirementMatchScore(item, query) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || (visits.get(b.item.id) ?? 0) - (visits.get(a.item.id) ?? 0)
      || b.item.updatedAt.localeCompare(a.item.updatedAt) || compareRequirementText(a.item.id, b.item.id))
    .map(({ item }) => item)
}
