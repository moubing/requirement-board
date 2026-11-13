<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from 'gsap'
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { X } from 'lucide-vue-next'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
import DemoHeader from './demo/DemoHeader.vue'
import { useAppShell } from '../composables/use-app-shell'

const access = useAccountAccessState()
const route = useRoute()
const { desktopOpen, mobile, mobileOpen } = useAppShell()
const demo = computed(() => route.path.replace(/\/+$/, '') === '/demo')
const enabled = computed(() => Boolean(!demo.value && access.value?.canAccessProject && !['/login', '/register', '/invite'].includes(route.path)))
const expanded = computed(() => enabled.value && (mobile.value ? mobileOpen.value : desktopOpen.value))
const root = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const navigation = ref<HTMLElement | null>(null)
const drawer = ref<HTMLDialogElement | null>(null)
let context: gsap.Context | undefined
let desktopTween: gsap.core.Tween | undefined
let navigationTween: gsap.core.Tween | undefined
let drawerTween: gsap.core.Tween | undefined
let narrow: MediaQueryList | undefined
let reduced: MediaQueryList | undefined
const focusToggle = () => root.value?.querySelector<HTMLButtonElement>('[data-shell-toggle]')?.focus({ preventScroll: true })
function closeMobile() { mobileOpen.value = false }
function navigateMobile() {
  // 先退出原生模态层，让路由守卫的错误或离开确认可以被读取和操作。
  mobileOpen.value = false
  drawerTween?.kill()
  drawer.value?.close()
  focusToggle()
}
function toggle() {
  if (mobile.value) mobileOpen.value = !mobileOpen.value
  else {
    if (desktopOpen.value && navigation.value?.contains(document.activeElement)) focusToggle()
    desktopOpen.value = !desktopOpen.value
  }
}
function syncDesktop(instant = false) {
  if (!context || !body.value || !navigation.value) return
  const open = enabled.value && !mobile.value && desktopOpen.value
  if (!open && navigation.value.contains(document.activeElement)) focusToggle()
  desktopTween?.kill(); navigationTween?.kill()
  const duration = instant || reduced?.matches ? 0 : 0.24
  context.add(() => {
    // 只有此处的网格占位改变布局，正文不缩放；新 tween 从当前进度反向。
    desktopTween = gsap.to(body.value, { '--app-nav-width': open ? getComputedStyle(body.value!).getPropertyValue('--app-sidebar-width').trim() : '0px', duration, ease: 'power2.inOut' })
    navigationTween = gsap.to(navigation.value, { x: open ? 0 : -24, autoAlpha: open ? 1 : 0, duration, ease: 'power2.inOut' })
  })
}
function syncDrawer(instant = false) {
  if (!context || !drawer.value) return
  const element = drawer.value
  const open = enabled.value && mobile.value && mobileOpen.value
  drawerTween?.kill()
  if (!open && !element.open) return
  if (open && !element.open) {
    element.showModal()
    context.add(() => { gsap.set(element, { xPercent: -100 }) })
  }
  context.add(() => {
    drawerTween = gsap.to(element, { xPercent: open ? 0 : -100, duration: instant || reduced?.matches ? 0 : 0.2, ease: 'power2.out',
      onComplete: () => { if (!open && element.open) { element.close(); focusToggle() } },
    })
  })
}
function backdrop(event: MouseEvent) {
  const element = drawer.value
  if (!element || event.target !== element) return
  const box = element.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeMobile()
}
function drawerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !drawer.value) return
  const controls = [...drawer.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
  const first = controls[0], last = controls.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function updateBreakpoint() {
  mobile.value = narrow?.matches ?? false
  mobileOpen.value = false
  syncDesktop(true); syncDrawer(true)
}
function updateMotion() { syncDesktop(true); syncDrawer(true) }
watch([desktopOpen, enabled], ([, available], [, wasAvailable]) => {
  if (!available) mobileOpen.value = false
  // 路由/身份切换直接使用目标布局，只有用户手动开合导航才播放宽度动画。
  const instant = available !== wasAvailable
  syncDesktop(instant); syncDrawer(instant)
}, { flush: 'post' })
watch(mobileOpen, () => syncDrawer(), { flush: 'post' })
watch(() => route.fullPath, closeMobile)
onMounted(() => {
  context = gsap.context(() => {}, root.value!)
  narrow = matchMedia('(max-width: 700px)'); reduced = matchMedia('(prefers-reduced-motion: reduce)')
  updateBreakpoint()
  narrow.addEventListener('change', updateBreakpoint)
  reduced.addEventListener('change', updateMotion)
})
onBeforeUnmount(() => {
  narrow?.removeEventListener('change', updateBreakpoint)
  reduced?.removeEventListener('change', updateMotion)
  context?.revert()
  drawer.value?.close()
})
</script>

<template>
  <div ref="root" class="app-shell">
    <DemoHeader v-if="demo" />
    <AppHeader v-else :show-navigation="enabled" :navigation-expanded="expanded" :mobile-navigation="mobile" @toggle-sidebar="toggle" />
    <div ref="body" class="app-shell__body" :data-sidebar-open="enabled && desktopOpen">
      <aside id="app-sidebar" class="app-sidebar" :inert="!enabled || !desktopOpen || mobile" :aria-hidden="!enabled || !desktopOpen || mobile">
        <div ref="navigation" class="app-sidebar__content"><AppSidebar v-if="!demo" /></div>
      </aside>
      <slot />
    </div>
    <!-- 原生模态导航提供 top-layer / inert / 焦点隔离；不改写 BingDialog 的私有布局。 -->
    <dialog id="app-mobile-navigation" ref="drawer" class="app-sidebar-dialog" aria-label="页面导航" :aria-modal="mobileOpen ? true : undefined"
      @cancel.prevent="closeMobile" @click="backdrop" @close="closeMobile" @keydown="drawerKeydown">
      <div class="app-sidebar-dialog__heading"><strong>页面导航</strong>
        <BingButton variant="ghost" size="lg" :throttle="false" aria-label="关闭导航" title="关闭导航" @click="closeMobile"><BingIcon :icon="X" :size="18" decorative /></BingButton>
      </div>
      <AppSidebar v-if="!demo" @navigate="navigateMobile" />
    </dialog>
  </div>
</template>
