import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import { gsap } from 'gsap'

interface DownwardRevealGeometry {
  elementBottom: number
  viewportBottom: number
  currentScrollTop: number
  maxScrollTop: number
  bottomGap?: number
}

interface EditorScrollController {
  viewport: HTMLElement | null
  stop: () => void
}

const DEFAULT_BOTTOM_GAP = 24
let scrollToPluginReady: Promise<void> | null = null

function ensureScrollToPlugin() {
  scrollToPluginReady ??= import('gsap/ScrollToPlugin').then(({ ScrollToPlugin }) => {
    gsap.registerPlugin(ScrollToPlugin)
  })
  return scrollToPluginReady
}

export function resolveDownwardRevealScrollTarget({
  elementBottom,
  viewportBottom,
  currentScrollTop,
  maxScrollTop,
  bottomGap = DEFAULT_BOTTOM_GAP,
}: DownwardRevealGeometry) {
  const values = [elementBottom, viewportBottom, currentScrollTop, maxScrollTop, bottomGap]
  if (values.some(value => !Number.isFinite(value)) || viewportBottom <= 0) return null

  // 已经完整出现在滚动容器视口内时不移动；bottomGap 只用于发生裁切后的落点。
  if (elementBottom <= viewportBottom) return null

  const desiredViewportBottom = Math.max(0, viewportBottom - Math.max(0, bottomGap))
  const desiredScrollTop = currentScrollTop + elementBottom - desiredViewportBottom
  const targetScrollTop = Math.min(
    Math.max(0, maxScrollTop),
    Math.max(currentScrollTop, desiredScrollTop),
  )
  return targetScrollTop > currentScrollTop + 0.5 ? Math.round(targetScrollTop) : null
}

function findUploadedImage(editorSurface: HTMLElement, diffId: string) {
  return Array.from(editorSurface.querySelectorAll<HTMLElement>('.requirement-image'))
    .find(element => element.dataset.imageDiffId === diffId) ?? null
}

export function useUploadedImageAutoScroll(
  getScrollController: () => EditorScrollController | null,
) {
  let mounted = false
  let reduceMotion = false
  let motionPreference: ReturnType<typeof gsap.matchMedia> | null = null
  let scrollTween: gsap.core.Tween | null = null
  const pendingFrames = new Set<number>()

  function killScrollTween() {
    scrollTween?.kill()
    scrollTween = null
  }

  function revealNow(diffId: string, editorSurface: HTMLElement) {
    const image = findUploadedImage(editorSurface, diffId)
    if (!image?.isConnected) return

    const scrollController = getScrollController()
    const scrollViewport = scrollController?.viewport
    if (!scrollController || !scrollViewport?.isConnected) return

    const imageRect = image.getBoundingClientRect()
    const viewportRect = scrollViewport.getBoundingClientRect()
    if (!imageRect.width || !imageRect.height || !viewportRect.height) return

    const currentScrollTop = scrollViewport.scrollTop
    const targetScrollTop = resolveDownwardRevealScrollTarget({
      elementBottom: imageRect.bottom,
      viewportBottom: viewportRect.bottom,
      currentScrollTop,
      maxScrollTop: Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight),
    })
    if (targetScrollTop === null) return

    killScrollTween()
    scrollController.stop()
    if (reduceMotion) {
      gsap.set(scrollViewport, { scrollTo: { y: targetScrollTop, autoKill: false } })
      return
    }

    const distance = targetScrollTop - currentScrollTop
    const duration = Math.min(0.52, Math.max(0.24, distance / 1400))
    const tween = gsap.to(scrollViewport, {
      scrollTo: {
        y: targetScrollTop,
        autoKill: true,
        onAutoKill: () => {
          if (scrollTween === tween) scrollTween = null
        },
      },
      duration,
      ease: 'power2.out',
      overwrite: 'auto',
      onComplete: () => {
        if (scrollTween === tween) scrollTween = null
      },
    })
    scrollTween = tween
  }

  async function reveal(diffId: string, editorSurface: HTMLElement) {
    await Promise.all([nextTick(), ensureScrollToPlugin()])
    if (!mounted || !editorSurface.isConnected) return

    const frameId = requestAnimationFrame(() => {
      pendingFrames.delete(frameId)
      if (mounted) revealNow(diffId, editorSurface)
    })
    pendingFrames.add(frameId)
  }

  onMounted(() => {
    mounted = true
    void ensureScrollToPlugin()

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
  })

  onBeforeUnmount(() => {
    mounted = false
    pendingFrames.forEach(frameId => cancelAnimationFrame(frameId))
    pendingFrames.clear()
    killScrollTween()
    motionPreference?.revert()
    motionPreference = null
  })

  return { reveal }
}
