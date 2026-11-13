<script setup lang="ts">
import { BingScrollbar, type BingScrollbarExpose } from '@moubing/bing-ui'
import { pageScrollViewportKey } from '~/utils/page-scroll-context'

const scrollbar = ref<BingScrollbarExpose | null>(null)
provide(pageScrollViewportKey, () => scrollbar.value?.viewport ?? null)
const router = useRouter()
const nuxtApp = useNuxtApp()
const positions = new Map<number, { top: number; left: number }>()
let entry = 0
let historyNavigation = false
let navigating = false
let pending: { top: number; left: number; hash?: string } | null = null
let frame = 0

function rememberPosition() {
  const viewport = scrollbar.value?.viewport
  if (viewport && !navigating) positions.set(entry, { top: viewport.scrollTop, left: viewport.scrollLeft })
}

function restorePosition() {
  if (!pending) return
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const target = pending
    const viewport = scrollbar.value?.viewport
    if (!target || !viewport) return
    pending = null
    let top = target.top
    if (target.hash) {
      let id = target.hash.slice(1)
      try { id = decodeURIComponent(id) } catch { /* 无效转义按原始 ID 查找。 */ }
      const element = document.getElementById(id)
      if (element && viewport.contains(element)) {
        top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
        top -= Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0
      }
    }
    scrollbar.value?.scrollTo({ top, left: target.left, behavior: 'instant' })
    navigating = false
    rememberPosition()
  })
}

onMounted(() => {
  entry = Number(router.options.history.state.position) || 0
  // 用 history entry 区分同一路径的多次访问，前进/后退恢复各自的位置。
  const removeHistoryListener = router.options.history.listen(() => { historyNavigation = true })
  const removeBefore = router.beforeEach(() => {
    rememberPosition()
    scrollbar.value?.stop()
    navigating = true
  })
  const removeAfter = router.afterEach((to, from, failure) => {
    if (failure) {
      historyNavigation = false
      navigating = false
      return
    }
    const previous = positions.get(entry) ?? { top: 0, left: 0 }
    entry = Number(router.options.history.state.position) || 0
    pending = historyNavigation && positions.has(entry)
      ? positions.get(entry)!
      : { ...(to.path === from.path && !from.hash ? previous : { top: 0, left: 0 }), hash: to.hash }
    historyNavigation = false
    if (to.path === from.path) void nextTick(restorePosition)
  })
  const removePageHook = nuxtApp.hook('page:loading:end', restorePosition)
  if (router.currentRoute.value.hash) {
    pending = { top: 0, left: 0, hash: router.currentRoute.value.hash }
    restorePosition()
  }
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    removeHistoryListener()
    removeBefore()
    removeAfter()
    removePageHook()
  })
})
</script>

<template>
  <BingScrollbar ref="scrollbar" class="app-page-scroll" style="--bing-scrollbar-gutter-left: var(--bing-scrollbar-gutter)" height="calc(100dvh - var(--app-header-height))" aria-label="页面内容" @scroll="rememberPosition">
    <div id="app-content" class="app-content" tabindex="-1"><slot /></div>
  </BingScrollbar>
</template>
