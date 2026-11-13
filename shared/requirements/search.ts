/** 与 PostgreSQL btrim/translate 使用同一组 ECMAScript 空白字符。 */
export const REQUIREMENT_SEARCH_WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'

export const normalizeRequirementSearch = (value: string) => value.normalize('NFKC').toLowerCase().trim()
export const normalizeRequirementNumber = (value: string) => normalizeRequirementSearch(value).replace(/[\s_-]/g, '')

export function requirementSearchTerms(query: string) {
  return normalizeRequirementSearch(query).split(/\s+/).filter(Boolean)
}

export function requirementMatchScore(item: { key: string; title: string }, query: string): number {
  const normalized = normalizeRequirementSearch(query)
  const tokens = requirementSearchTerms(query)
  if (!tokens.length) return 0
  const key = normalizeRequirementNumber(item.key)
  const title = normalizeRequirementSearch(item.title)
  if (!tokens.every(token => key.includes(normalizeRequirementNumber(token)) || title.includes(token))) return -1
  const combined = normalizeRequirementNumber(query)
  if (key === combined) return 0
  if (key.startsWith(combined)) return 1
  if (title.startsWith(normalized)) return 2
  return 3
}

/** UTF-8 数据库 COLLATE "C" 的 Unicode 码点顺序，不依赖浏览器语言。 */
export function compareRequirementText(left: string, right: string) {
  const a = Array.from(left), b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (difference) return difference
  }
  return a.length - b.length
}

export function orderRequirementAssignees<T extends { id: string; name: string }>(people: T[]): T[] {
  return [...people].sort((a, b) => compareRequirementText(a.name, b.name) || compareRequirementText(a.id, b.id))
}

export function requirementAssigneeSortText(people: { id: string; name: string }[]) {
  return orderRequirementAssignees(people).map(person => person.name).join('、')
}
