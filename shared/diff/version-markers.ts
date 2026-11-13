import type { DiffBlockPair, RichTextDiffResult } from './rich-text-diff'
import type { RevertChangePayload } from './revert-draft-change'
import type { RichTextDocument } from '../editor/document'

/** 一份核对结果同时服务正文状态、页边标记和最新版本比较。 */
export interface ContentComparison {
  base: RichTextDocument
  target: RichTextDocument
  result: RichTextDiffResult
}

export interface VersionMarker extends RevertChangePayload {
  id: string
  targetId: string | null
  beforeId: string | null
  afterId: string | null
}

/** 只映射既有 Diff 对齐结果；连续删除共用一个缝隙，新增和修改保持块粒度。 */
export function buildVersionMarkers(pairs: DiffBlockPair[]): VersionMarker[] {
  const markers: VersionMarker[] = []
  let beforeId: string | null = null
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index]!
    if (pair.status === 'deleted') {
      const deleted = [pair]
      while (pairs[index + 1]?.status === 'deleted') deleted.push(pairs[++index]!)
      markers.push({ id: `deleted:${deleted[0]!.base!.id}`, status: 'deleted', pairs: deleted,
        targetId: null, beforeId, afterId: pairs[index + 1]?.target?.id ?? null })
    } else {
      if (pair.status !== 'unchanged') markers.push({ id: `${pair.status}:${pair.target!.id}`, status: pair.status,
        pairs: [pair], targetId: pair.target!.id, beforeId, afterId: null })
      beforeId = pair.target?.id ?? beforeId
    }
  }
  return markers
}
