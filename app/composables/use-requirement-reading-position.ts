import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import type { BingScrollbarExpose } from '@moubing/bing-ui'
import { detailReturnTiming } from '../utils/detail-return-timing'
import { cancelEditorGeometry, scheduleEditorGeometry } from '../components/editor/editor-geometry'
import { EDITOR_READING_POSITION_RESTORED_EVENT } from '../components/editor/editor-layout-events'

/** 仅保留当前标签页的阅读位置，不持久化编辑器实例或正文。 */
export function useRequirementReadingPosition(id: () => string | undefined, scrollbar: Ref<BingScrollbarExpose | null>, active: () => boolean = () => true, root?: () => HTMLElement | undefined, restoreAllowed: () => boolean = () => true) {
  const access = useAccountAccessState()
  const positions = useState<Record<string, { top: number; left: number }>>('requirement-reading-positions', () => ({}))
  const owner = useState('requirement-reading-owner', () => '')
  const user = access.value?.user.id ?? ''
  if (owner.value !== user) { positions.value = {}; owner.value = user }
  const requirementId = id()
  const key = requirementId ? `${user}:${requirementId}` : ''
  let disposed = false
  let interacted = false
  const geometryOwner = {}
  let geometryRoot: HTMLElement | null = null
  let generation = 0
  let mounted = false
  let listening: HTMLElement | null = null
  let lastPosition: { top: number; left: number } | undefined
  const interrupt = () => { interacted = true }
  function capture() {
    if (listening?.clientWidth) lastPosition = { top: listening.scrollTop, left: listening.scrollLeft }
  }
  function pause() {
    generation++
    if (geometryRoot) cancelEditorGeometry(geometryRoot, geometryOwner)
    capture()
    if (key && lastPosition && owner.value === user) {
      positions.value[key] = lastPosition
      const keys = Object.keys(positions.value)
      if (keys.length > 100) delete positions.value[keys[0]!]
    }
    listening?.removeEventListener('wheel', interrupt)
    listening?.removeEventListener('pointerdown', interrupt)
    listening?.removeEventListener('keydown', interrupt)
    listening?.removeEventListener('scroll', capture)
    listening = null
  }
  async function resume() {
    if (!key || disposed || !mounted || !active()) return
    pause()
    const current = generation
    interacted = false
    const viewport = scrollbar.value?.viewport
    listening = viewport ?? null
    viewport?.addEventListener('wheel', interrupt, { passive: true })
    viewport?.addEventListener('pointerdown', interrupt)
    viewport?.addEventListener('keydown', interrupt)
    viewport?.addEventListener('scroll', capture, { passive: true })
    const previous = positions.value[key]
    if (!previous || !restoreAllowed()) return
    const endRestore = detailReturnTiming(requirementId)?.start('reading-position')
    await nextTick()
    if (document.fonts?.status === 'loading') await document.fonts.ready
    if (disposed || interacted || current !== generation || !viewport || !restoreAllowed()) return
    geometryRoot = root?.() ?? viewport
    scheduleEditorGeometry(geometryRoot, geometryOwner, () => {
      if (disposed || interacted || current !== generation || !active() || !viewport.clientWidth || !restoreAllowed()) return
      const top = Math.max(0, Math.min(previous.top, viewport.scrollHeight - viewport.clientHeight))
      const left = Math.max(0, Math.min(previous.left, viewport.scrollWidth - viewport.clientWidth))
      return () => {
        if (disposed || interacted || current !== generation || !active() || !restoreAllowed()) return
        scrollbar.value?.stop()
        viewport.scrollTop = top
        viewport.scrollLeft = left
        viewport.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT))
        capture()
        endRestore?.()
      }
    })
  }
  onMounted(() => { mounted = true; void resume() })
  watch(restoreAllowed, allowed => {
    if (!allowed) { generation++; if (geometryRoot) cancelEditorGeometry(geometryRoot, geometryOwner) }
  }, { flush: 'sync' })
  watch(active, value => { if (value) void nextTick(resume); else pause() }, { flush: 'sync' })
  onBeforeUnmount(() => {
    pause(); disposed = true
  })
}
