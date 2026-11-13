import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface ChapterNavigator {
  navigateToChapter: (id: string, signal: AbortSignal) => Promise<'reached' | 'missing' | 'cancelled'>
}

/** 路由意图只消费一次；缓存返回、编辑器重建、协作重连均不重新播放旧链接。 */
export function useRequirementChapterLink(options: {
  requirementId: string
  routeId: () => string
  block: () => unknown
  active: () => boolean
  ready: () => boolean
  editor: () => ChapterNavigator | null
  showBody: () => void
  missing: () => Promise<unknown>
}) {
  const pending = ref<string | null>(null)
  let lastBlock: string | null | undefined
  let controller: AbortController | undefined
  let mounted = false
  function cancel() { controller?.abort(); controller = undefined; pending.value = null }
  const routeBlock = () => {
    const value = options.block()
    if (value === undefined) return null
    return String((Array.isArray(value) ? value[0] : value) ?? '')
  }
  watch([options.routeId, routeBlock], ([routeId, block]) => {
    if (routeId !== options.requirementId) { cancel(); return }
    if (block === lastBlock) return
    lastBlock = block
    cancel()
    if (block !== null) { pending.value = block; options.showBody() }
  }, { immediate: true, flush: 'sync' })

  async function navigate() {
    if (!mounted || !options.active() || !options.ready() || !options.editor() || pending.value === null || controller) return
    const id = pending.value
    const current = controller = new AbortController()
    await nextTick()
    if (current.signal.aborted) return
    try {
      const result = await options.editor()!.navigateToChapter(id, current.signal)
      if (current.signal.aborted || controller !== current) return
      if (result === 'missing') await options.missing()
    } finally {
      if (controller === current) { controller = undefined; pending.value = null }
    }
  }
  function interrupt() {
    if (options.active() && options.routeId() === options.requirementId && pending.value !== null) cancel()
  }
  watch([options.active, options.ready, options.editor, pending], () => {
    if (!options.active() || !options.ready() || !options.editor()) { controller?.abort(); controller = undefined }
    else void navigate()
  }, { flush: 'post' })
  onMounted(() => {
    mounted = true
    for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown']) window.addEventListener(event, interrupt, { capture: true, passive: true })
    void navigate()
  })
  onBeforeUnmount(() => {
    mounted = false; cancel()
    for (const event of ['pointerdown', 'wheel', 'touchstart', 'keydown']) window.removeEventListener(event, interrupt, true)
  })
  return { pending: computed(() => pending.value !== null) }
}
