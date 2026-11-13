export interface RevisionIdentity {
  id: string
}

export function resolveRevisionId(
  revisions: readonly RevisionIdentity[],
  selectedId: string,
) {
  if (selectedId && revisions.some((revision) => revision.id === selectedId)) {
    return selectedId
  }

  return revisions[0]?.id ?? ''
}

export interface ComparisonSelection {
  baseId: string
  targetId: string
}

// 当前草稿紧接最新正式版本；按实际版本顺序配对，不依赖数组顺序或版本号连续。
export function resolveComparisonSelection(
  revisions: readonly (RevisionIdentity & { version: number })[],
  selection: ComparisonSelection,
  changed: 'base' | 'target',
  adjacent: boolean,
  draftId: string,
): ComparisonSelection {
  const saved = [...revisions].sort((a, b) => a.version - b.version).map(revision => revision.id)
  if (!saved.length) return { baseId: '', targetId: draftId }
  const ordered = [...saved, draftId]
  const baseId = saved.includes(selection.baseId) ? selection.baseId : saved.at(-1)!
  const targetId = ordered.includes(selection.targetId) ? selection.targetId : draftId
  if (!adjacent) return { baseId, targetId }

  const baseIndex = changed === 'base'
    ? saved.indexOf(baseId)
    : Math.max(0, ordered.indexOf(targetId) - 1)
  return { baseId: ordered[baseIndex]!, targetId: ordered[baseIndex + 1]! }
}
