import type { Editor } from '@tiptap/core'
import { gsap } from 'gsap'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue'

import type { RichTextDocument } from '../../../shared/editor/document'
import { EDITOR_LAYOUT_MOTION_FRAME_EVENT, EDITOR_READING_POSITION_RESTORED_EVENT } from './editor-layout-events'
import { findChapterHeading } from './chapter-link'
import { isInsideClosedDetails, revealDetailsAncestors } from './details-visibility'
import { cancelEditorGeometry, scheduleEditorGeometry } from './editor-geometry'
import {
  collectRequirementOutline,
  resolveActiveOutlineIds,
  resolveOutlineScrollTarget,
} from './requirement-outline-logic'

interface EditorScrollController {
  viewport: HTMLElement | null
  stop: () => void
}

interface RequirementOutlineOptions {
  enabled: Readonly<Ref<boolean>>
  active?: Readonly<Ref<boolean>>
  ignoreCompact?: Readonly<Ref<boolean>>
  editor: Readonly<Ref<Editor | null | undefined>>
  content: Readonly<Ref<RichTextDocument>>
  getScrollController: () => EditorScrollController | null
  onArrive?: (id: string) => void
}

let scrollToPluginReady: Promise<void> | null = null

function ensureScrollToPlugin() {
  scrollToPluginReady ??= import('gsap/ScrollToPlugin').then(({ ScrollToPlugin }) => {
    gsap.registerPlugin(ScrollToPlugin)
  })
  return scrollToPluginReady
}

function sameIds(current: readonly string[], next: readonly string[]) {
  return current.length === next.length && current.every((id, index) => id === next[index])
}

export function useRequirementOutline({
  enabled,
  active = enabled,
  ignoreCompact,
  editor,
  content,
  getScrollController,
  onArrive,
}: RequirementOutlineOptions) {
  const compact = ref(false)
  const visible = computed(() => enabled.value && (ignoreCompact?.value || !compact.value))
  const activeIds = ref<string[]>([])
  const scrolling = ref(false)
  const items = computed<ReturnType<typeof collectRequirementOutline>>((previous) => {
    const next = visible.value ? collectRequirementOutline(content.value) : []
    return previous && previous.length === next.length && previous.every((item, index) => {
      const other = next[index]!
      return item.id === other.id && item.label === other.label && item.level === other.level
    }) ? previous : next
  })

  let mounted = false
  let reduceMotion = false
  let viewport: HTMLElement | null = null
  let surface: HTMLElement | null = null
  const geometryOwner = {}
  let headings: HTMLElement[] | null = null
  let layout: { id: string; top: number; bottom: number }[] | null = null
  let contentTimer: ReturnType<typeof setTimeout> | undefined
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  let motionPreference: ReturnType<typeof gsap.matchMedia> | null = null
  let scrollTween: gsap.core.Tween | null = null
  let chapterScroll = false
  let compactMedia: MediaQueryList | null = null
  const updateCompact = () => { compact.value = compactMedia?.matches ?? false }

  function killScrollTween() {
    scrollTween?.kill()
    scrollTween = null
    chapterScroll = false
    scrolling.value = false
  }

  function setActiveIds(nextIds: string[]) {
    if (!sameIds(activeIds.value, nextIds)) activeIds.value = nextIds
  }

  function headingElements() {
    if (!surface) return []
    if (headings) return headings
    const itemIds = new Set(items.value.map(item => item.id))
    headings = Array.from(
      surface.querySelectorAll<HTMLElement>(
        'h1[data-diff-id], h2[data-diff-id], h3[data-diff-id]',
      ),
    ).filter(element => itemIds.has(element.dataset.diffId ?? ''))
    return headings
  }

  function updateActiveNow() {
    if (!mounted || !visible.value) return
    bindElements()
    if (!viewport || !surface || !items.value.length) {
      return () => setActiveIds([])
    }

    const viewportRect = viewport.getBoundingClientRect()
    if (!viewportRect.height) {
      return () => setActiveIds([])
    }

    const offset = viewport.scrollTop - viewportRect.top
    layout ??= headingElements().filter(element => !isInsideClosedDetails(element)).map((element) => {
      const rect = element.getBoundingClientRect()
      return { id: element.dataset.diffId ?? '', top: rect.top + offset, bottom: rect.bottom + offset }
    })
    const next = resolveActiveOutlineIds(layout, viewportRect.top + offset, viewportRect.bottom + offset)
    return () => { if (mounted && visible.value) setActiveIds(next) }
  }

  function scheduleActiveUpdate() {
    if (!mounted || !visible.value) return
    bindElements()
    if (surface) scheduleEditorGeometry(surface, geometryOwner, updateActiveNow)
  }

  function invalidateLayout() {
    layout = null
    scheduleActiveUpdate()
  }

  function unbindElements() {
    viewport?.removeEventListener('scroll', scheduleActiveUpdate)
    surface?.removeEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, invalidateLayout)
    if (surface) cancelEditorGeometry(surface, geometryOwner)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    headings = null
    layout = null
    viewport = null
    surface = null
  }

  function bindElements() {
    const nextViewport = getScrollController()?.viewport ?? null
    const nextSurface = editor.value?.view.dom ?? null
    if (nextViewport === viewport && nextSurface === surface) return

    unbindElements()
    viewport = nextViewport
    surface = nextSurface
    viewport?.addEventListener('scroll', scheduleActiveUpdate, { passive: true })
    surface?.addEventListener(EDITOR_LAYOUT_MOTION_FRAME_EVENT, invalidateLayout)

    mutationObserver ??= new MutationObserver(records => {
      if (!records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))) return
      headings = null
      invalidateLayout()
    })
    if (surface) mutationObserver.observe(surface, { childList: true, subtree: true })

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver ??= new ResizeObserver(invalidateLayout)
      if (viewport) resizeObserver.observe(viewport)
      if (surface) resizeObserver.observe(surface)
    }
  }

  function scheduleBindAndUpdate() {
    if (!mounted || !visible.value) return
    void nextTick().then(() => {
      if (!mounted || !visible.value) return
      headings = null
      invalidateLayout()
    })
  }

  async function scrollToHeading(diffId: string, instant = false, signal?: AbortSignal): Promise<boolean> {
    if (!mounted || !active.value || signal?.aborted) return false
    await Promise.all([nextTick(), ensureScrollToPlugin()])
    if (!mounted || !active.value || signal?.aborted) return false

    const scrollController = getScrollController()
    const root = editor.value?.view.dom
    let target = root ? findChapterHeading(root, diffId) : null
    const scrollViewport = scrollController?.viewport
    if (!scrollController || !target?.isConnected || !scrollViewport?.isConnected) return false
    revealDetailsAncestors(target)

    // 首屏字体、侧栏和节点视图可能继续排版；定位期间只测量这一个目标。
    const destination = () => {
      // DOM 属性变化可能让 ProseMirror 重建节点；章节身份由 diffId 决定。
      if (!target?.isConnected && root?.isConnected) target = findChapterHeading(root, diffId)
      if (target) revealDetailsAncestors(target)
      return target?.isConnected && scrollViewport.isConnected ? resolveOutlineScrollTarget({
        targetTop: target.getBoundingClientRect().top,
        viewportTop: scrollViewport.getBoundingClientRect().top,
        currentScrollTop: scrollViewport.scrollTop,
        maxScrollTop: Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight),
      }) : null
    }
    const targetScrollTop = destination()
    if (targetScrollTop === null) return false

    scrollController.stop()
    killScrollTween()
    if (instant || reduceMotion || Math.abs(targetScrollTop - scrollViewport.scrollTop) < 1) {
      gsap.set(scrollViewport, { scrollTo: { y: targetScrollTop, autoKill: false } })
      scrollViewport.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT))
      scheduleActiveUpdate()
      onArrive?.(diffId)
      return true
    }

    chapterScroll = Boolean(signal)
    scrolling.value = true
    return new Promise<boolean>(resolve => {
      let tween: gsap.core.Tween
      let settled = false
      let segment = 0
      const cancel = () => tween.kill()
      const finish = (reached: boolean) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', cancel)
        if (scrollTween === tween) { scrollTween = null; chapterScroll = false }
        scrolling.value = false
        scrollViewport.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT))
        scheduleActiveUpdate()
        if (reached) onArrive?.(diffId)
        resolve(reached)
      }
      const animate = (top: number) => {
        const current = ++segment
        // 从当前滚动位置续接新的目标，旧动画的 interrupt 不代表用户取消。
        tween?.kill()
        tween = gsap.to(scrollViewport, {
          scrollTo: { y: top, autoKill: true, onAutoKill: () => { if (current === segment) finish(false) } },
          duration: Math.min(0.58, Math.max(0.28, Math.abs(top - scrollViewport.scrollTop) / 1500)),
          ease: 'power2.out', overwrite: 'auto',
          onUpdate: () => {
            if (current !== segment || settled) return
            const next = destination()
            if (next === null) { tween.kill(); return }
            if (Math.abs(next - top) >= 1) animate(next)
            scheduleActiveUpdate()
          },
          onComplete: () => {
            if (current !== segment || settled) return
            const next = destination()
            if (next !== null && Math.abs(next - scrollViewport.scrollTop) >= 1) animate(next)
            else finish(next !== null)
          },
          onInterrupt: () => { if (current === segment) finish(false) },
        })
        scrollTween = tween
      }
      animate(targetScrollTop)
      signal?.addEventListener('abort', cancel, { once: true })
    })
  }

  watch([editor, items], scheduleBindAndUpdate, { flush: 'post' })
  // 普通输入不逐键测量所有标题。换行/图片尺寸由 ResizeObserver 即时失效；
  // 空闲时补核同高度表格、格式等未改变正文外框的布局变化。
  watch(content, () => {
    clearTimeout(contentTimer)
    if (mounted && visible.value) contentTimer = setTimeout(invalidateLayout, 200)
  }, { flush: 'post' })
  function suspend() {
    clearTimeout(contentTimer)
    // 链接定位不依赖目录是否展开；首次响应式布局可能暂时收起目录。
    if (!chapterScroll) killScrollTween()
    unbindElements()
    setActiveIds([])
  }
  watch(visible, value => {
    if (!mounted) return
    if (value) scheduleBindAndUpdate()
    else suspend()
  }, { flush: 'sync' })
  watch(active, value => { if (!value) killScrollTween() }, { flush: 'sync' })

  onMounted(async () => {
    mounted = true
    // 与 editor-workspace.css 的目录隐藏断点一致。
    compactMedia = window.matchMedia('(max-width: 1240px)')
    updateCompact()
    compactMedia.addEventListener('change', updateCompact)
    motionPreference = gsap.matchMedia()
    motionPreference.add('(prefers-reduced-motion: reduce)', () => {
      reduceMotion = true
      const activeTween = scrollTween
      scrollTween = null
      if (activeTween) {
        activeTween.progress(1)
        activeTween.kill()
      }
      return () => {
        reduceMotion = false
      }
    })

    await nextTick()
    scheduleBindAndUpdate()
  })

  onBeforeUnmount(() => {
    mounted = false
    killScrollTween()
    suspend()
    compactMedia?.removeEventListener('change', updateCompact)
    resizeObserver = null
    motionPreference?.revert()
    motionPreference = null
  })

  return {
    activeIds,
    scrolling,
    items,
    scrollToHeading,
  }
}
