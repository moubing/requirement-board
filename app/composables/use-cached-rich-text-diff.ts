import { onScopeDispose, shallowRef, toRaw, watch } from 'vue'
import type { RichTextDocument } from '../../shared/editor/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import type { ContentComparison } from '../../shared/diff/version-markers'

/** 每个文档视图独占、最多两组结果；正文以不可变对象身份失效，无需序列化全文。 */
export function useCachedRichTextDiff(input: {
  active: () => boolean
  base: () => RichTextDocument | null
  target: () => RichTextDocument | null
  key: () => string
  scope: () => string
  comparison?: () => ContentComparison | null | undefined
}) {
  type Entry = { base: RichTextDocument; target: RichTextDocument; result: ReturnType<typeof buildRichTextDiff> }
  const cache = new Map<string, Entry>()
  const diff = shallowRef<ReturnType<typeof buildRichTextDiff> | null>(null)
  let scope = input.scope()
  watch([input.active, input.base, input.target, input.key, input.scope], () => {
    if (scope !== input.scope()) { cache.clear(); scope = input.scope(); diff.value = null }
    if (!input.active()) return
    const base = toRaw(input.base()), target = toRaw(input.target())
    if (!base || !target) { diff.value = null; return }
    const key = `rich-text-diff-v1:${input.key()}`
    const previous = cache.get(key)
    const shared = input.comparison?.()
    const entry = previous?.base === base && previous.target === target
      ? previous : { base, target, result: shared?.base === base && shared.target === target ? shared.result : buildRichTextDiff(base, target) }
    cache.delete(key)
    cache.set(key, entry)
    if (cache.size > 2) cache.delete(cache.keys().next().value!)
    diff.value = entry.result
  }, { immediate: true })
  onScopeDispose(() => cache.clear())
  return diff
}
