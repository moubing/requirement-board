import { computed, getCurrentInstance, onMounted, onScopeDispose, shallowRef, toRaw, watch, type Ref } from 'vue'
import { richTextContentKey } from '../../shared/editor/content-equality'
import type { RichTextDocument } from '../../shared/editor/document'
import { richTextDiffSteps } from '../../shared/diff/rich-text-diff'
import { buildVersionMarkers, type ContentComparison } from '../../shared/diff/version-markers'

/** 输入立即保留待核对状态；只在空闲、最长期限或明确边界核对正文语义。 */
export function useContentModified(content: Ref<RichTextDocument>, baseline: Readonly<Ref<RichTextDocument | null>>, ready: Readonly<Ref<boolean>>,
  options: { active?: () => boolean; markers?: () => boolean } = {}) {
  const modified = shallowRef<boolean | null>(null)
  const comparison = shallowRef<ContentComparison | null>(null)
  const visible = shallowRef(typeof document === 'undefined' || !document.hidden)
  const active = computed(() => visible.value && (options.active?.() ?? true))
  const baselineKey = computed(() => baseline.value ? richTextContentKey(toRaw(baseline.value)) : null)
  const markers = computed(() => options.markers?.() && comparison.value ? buildVersionMarkers(comparison.value.result.pairs) : [])
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let sliceTimer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let processing = false
  function cancelCalculation() { generation++; clearTimeout(sliceTimer); processing = false }
  function reconcile() {
    clearTimeout(timer); clearTimeout(deadline)
    timer = deadline = undefined
    if (!active.value || !ready.value) return
    const base = toRaw(baseline.value), target = toRaw(content.value)
    if (base && options.markers?.()) {
      if (comparison.value?.base !== base || comparison.value.target !== target) {
        const attempt = ++generation
        const steps = richTextDiffSteps(base, target)
        processing = true
        const advance = () => {
          if (attempt !== generation || !active.value) return
          const started = performance.now()
          let step = steps.next()
          while (!step.done && performance.now() - started < 6) step = steps.next()
          if (!step.done) { sliceTimer = setTimeout(advance, 0); return }
          processing = false
          comparison.value = { base, target, result: step.value }
          const { inserted, deleted, modified: changed } = step.value.counts
          modified.value = inserted + deleted + changed > 0
        }
        advance()
        return
      }
      const { inserted, deleted, modified: changed } = comparison.value.result.counts
      modified.value = inserted + deleted + changed > 0
    } else {
      comparison.value = null
      modified.value = !base || (target !== base && richTextContentKey(target) !== baselineKey.value)
    }
  }
  watch([content, baseline, ready, active, () => options.markers?.()], () => {
    if (processing) cancelCalculation()
    clearTimeout(timer)
    modified.value = null
    if (!options.markers?.() || !baseline.value || !ready.value) comparison.value = null
    if (!active.value || !ready.value) { clearTimeout(deadline); deadline = undefined; return }
    timer = setTimeout(reconcile, 200)
    deadline ??= setTimeout(reconcile, 1500)
  }, { immediate: true, flush: 'sync' })
  const updateVisibility = () => { visible.value = !document.hidden }
  if (getCurrentInstance()) onMounted(() => { updateVisibility(); document.addEventListener('visibilitychange', updateVisibility) })
  onScopeDispose(() => {
    cancelCalculation()
    clearTimeout(timer); clearTimeout(deadline)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', updateVisibility)
  })
  return { modified, comparison, markers }
}
