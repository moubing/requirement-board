<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Component } from 'vue'
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { FileText, GitCompareArrows, Pause, Play, Sparkles, UsersRound } from 'lucide-vue-next'

const props = defineProps<{ state: 'idle' | 'submitting' | 'success' | 'error' }>()
const root = ref<HTMLElement | null>(null)
const interactionRoot = ref<HTMLElement | null>(null)
const preview = shallowRef<Component>()
const reduced = ref(true)
const finePointer = ref(false)
const desktop = ref(false)
const inactive = ref(false)
const hovered = ref(false)
const focused = ref(false)
const paused = ref(false)
const active = ref(0)
const cycle = ref(0)
const manuallySelected = ref(false)
const stopped = computed(() => reduced.value || !desktop.value || !preview.value || inactive.value || hovered.value || focused.value || paused.value || props.state !== 'idle')
const features = [
  { icon: UsersRound, title: '实时共同编辑', text: '想法在同一页，协作在同一刻。' },
  { icon: GitCompareArrows, title: '版本对比', text: '每一次修改，都有清晰的来路。' },
  { icon: Sparkles, title: 'AI 协作', text: '从一条标注，到一份更完整的文档。' },
]
const duration = 4000
let timer: ReturnType<typeof setTimeout> | undefined
let remaining = duration
let startedAt = 0
let frame = 0
let entranceFrame = 0
let pointerX = 0, pointerY = 0
let disposed = false, loading = false
const queries: MediaQueryList[] = []

// CSS 时间轴和轮播同时暂停；恢复时使用剩余时间，不重播当前场景。
function stopClock() {
  if (timer === undefined) return
  clearTimeout(timer); timer = undefined
  remaining = Math.max(0, remaining - (performance.now() - startedAt))
}
function startClock() {
  if (stopped.value || timer !== undefined) return
  startedAt = performance.now()
  timer = setTimeout(() => {
    timer = undefined
    remaining = duration
    active.value = (active.value + 1) % features.length
    manuallySelected.value = false
    cycle.value++
    startClock()
  }, remaining)
}
function selectFeature(index: number) {
  if (props.state !== 'idle') return
  stopClock()
  active.value = index
  // 手动选择直接呈现完整画面，悬停/键盘暂停时也能读懂场景。
  manuallySelected.value = true
  cycle.value++
  remaining = duration
  startClock()
}
function resetPointer() {
  cancelAnimationFrame(frame); frame = 0
  for (const name of ['--parallax-x', '--parallax-y']) root.value?.style.removeProperty(name)
}
async function loadPreview() {
  if (!desktop.value || preview.value || loading || disposed) return
  loading = true
  try {
    const module = await import('./LoginScenePreview.vue')
    if (!disposed) preview.value = module.default
  } catch {
    // 装饰模块不可用时保留静态文档占位，不影响表单。
  } finally { loading = false }
}
function updateEnvironment() {
  const wasReduced = reduced.value
  reduced.value = queries[0]?.matches ?? true
  finePointer.value = queries[1]?.matches ?? false
  desktop.value = queries[2]?.matches ?? false
  inactive.value = document.hidden
  if (reduced.value && !wasReduced) {
    stopClock(); active.value = 0; manuallySelected.value = false; cycle.value++; remaining = duration
  }
  if (reduced.value || !finePointer.value || !desktop.value || inactive.value) resetPointer()
  cancelAnimationFrame(entranceFrame)
  entranceFrame = requestAnimationFrame(() => { void loadPreview() })
}
function pointerMove(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || !finePointer.value) return
  hovered.value = interactionRoot.value?.contains(event.target as Node | null) ?? false
  if (reduced.value || !desktop.value || inactive.value || paused.value || props.state !== 'idle') return
  pointerX = Math.max(-1, Math.min(1, event.clientX / window.innerWidth * 2 - 1))
  pointerY = Math.max(-1, Math.min(1, event.clientY / window.innerHeight * 2 - 1))
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    root.value?.style.setProperty('--parallax-x', `${pointerX * 5}px`)
    root.value?.style.setProperty('--parallax-y', `${pointerY * 5}px`)
  })
}
function leaveWindow() { inactive.value = true; hovered.value = false; resetPointer() }
function pointerLeave(event: PointerEvent) { if (!event.relatedTarget) { hovered.value = false; resetPointer() } }
function focusOut(event: FocusEvent) { if (!interactionRoot.value?.contains(event.relatedTarget as Node | null)) focused.value = false }
watch(stopped, value => { if (value) stopClock(); else startClock() })
watch(() => props.state, state => { if (state !== 'idle') resetPointer() })
watch(paused, value => { if (value) resetPointer() })
onMounted(() => {
  queries.push(matchMedia('(prefers-reduced-motion: reduce)'), matchMedia('(hover: hover) and (pointer: fine)'), matchMedia('(min-width: 1024px)'))
  queries.forEach(query => query.addEventListener('change', updateEnvironment))
  updateEnvironment()
  window.addEventListener('pointermove', pointerMove, { passive: true })
  document.addEventListener('pointerout', pointerLeave)
  window.addEventListener('blur', leaveWindow)
  window.addEventListener('focus', updateEnvironment)
  document.addEventListener('visibilitychange', updateEnvironment)
})
onBeforeUnmount(() => {
  disposed = true
  stopClock(); cancelAnimationFrame(entranceFrame); cancelAnimationFrame(frame)
  queries.forEach(query => query.removeEventListener('change', updateEnvironment))
  window.removeEventListener('pointermove', pointerMove)
  document.removeEventListener('pointerout', pointerLeave)
  window.removeEventListener('blur', leaveWindow)
  window.removeEventListener('focus', updateEnvironment)
  document.removeEventListener('visibilitychange', updateEnvironment)
})
</script>

<template>
  <section ref="root" class="login-brand" :data-paused="stopped" :data-state="state" aria-label="关于文档看板">
    <div class="login-brand__heading">
      <div class="login-brand__identity">
        <img src="/requirement-board-logo.png" alt="" width="48" height="48" decoding="async">
        <p>文档看板</p>
      </div>
      <p class="login-brand__intro">把想法写下来，让进展看得见。</p>
    </div>
    <div ref="interactionRoot" class="login-brand__demo" @pointerenter="hovered = $event.pointerType === 'mouse'" @pointerleave="hovered = false" @focusin="focused = true" @focusout="focusOut">
      <div class="login-brand__scene" aria-hidden="true">
        <component :is="preview" v-if="preview && desktop" :key="cycle" :scene="active" :state="state" :paused="stopped" :static-frame="reduced || manuallySelected" />
        <div v-else class="login-brand__placeholder">
          <span><BingIcon :icon="FileText" :size="17" decorative /> 团队空间 / 产品设计</span>
          <strong>文档协作体验优化</strong>
          <p>把团队的想法写在同一页。</p>
          <p>一起完善需求，留下每一次修改的来路。</p>
        </div>
      </div>
      <div class="login-brand__features">
        <div class="login-brand__tabs" role="group" aria-label="产品亮点">
          <button v-for="(feature, index) in features" :key="feature.title" class="login-brand__feature" type="button" :aria-pressed="active === index" :disabled="state !== 'idle'" @click="selectFeature(index)">
            <BingIcon :icon="feature.icon" :size="16" decorative />{{ feature.title }}
            <span v-if="active === index" :key="cycle" class="login-brand__progress" :class="{ 'is-static': reduced }" :style="{ animationPlayState: stopped ? 'paused' : 'running' }" aria-hidden="true" />
          </button>
        </div>
        <BingButton v-if="!reduced" variant="ghost" size="xs" :aria-label="paused ? '播放品牌动效' : '暂停品牌动效'" :aria-pressed="paused" :throttle="false" @click="paused = !paused">
          <BingIcon :icon="paused ? Play : Pause" :size="14" decorative />
        </BingButton>
      </div>
      <div class="login-brand__captions" aria-live="off">
        <p v-for="(feature, index) in features" :key="feature.title" :class="{ 'is-active': active === index }" :aria-hidden="active !== index">{{ feature.text }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.login-brand { min-width: 0; padding: 8px 16px 8px 0; }
.login-brand__identity { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.login-brand__identity img { object-fit: contain; }
.login-brand__identity p { margin: 0; font-size: 16px; font-weight: 800; color: var(--rb-navy); }
.login-brand__intro { margin: 0; font-size: 17px; color: var(--rb-muted); line-height: 1.7; }
.login-brand__scene { position: relative; height: 338px; margin-top: 24px; }
.login-brand__placeholder { display: grid; align-content: start; gap: 16px; height: 322px; padding: 24px; border: 1px solid var(--rb-border); border-radius: 12px; color: var(--rb-ink); background: var(--rb-panel); }
.login-brand__placeholder > span { display: flex; gap: 8px; align-items: center; margin-bottom: 24px; font-size: 11px; color: var(--rb-muted); }
.login-brand__placeholder strong { font-size: 17px; }
.login-brand__placeholder p { margin: 0; font-size: 12px; line-height: 1.8; }
.login-brand__features { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.login-brand__tabs { display: flex; flex: 1; min-width: 0; border-bottom: 1px solid var(--rb-border); }
.login-brand__feature { position: relative; display: flex; align-items: center; justify-content: center; gap: 7px; flex: 1; padding: 13px 5px; border: 0; color: var(--rb-muted); background: none; font: 12px/1.5 var(--font-main); white-space: nowrap; cursor: pointer; transition: color 180ms; }
.login-brand__feature[aria-pressed="true"] { color: var(--rb-ink); font-weight: 700; }
.login-brand__feature:disabled { cursor: default; }
.login-brand__feature:focus-visible { outline: 2px solid var(--bing-focus-ring); outline-offset: 2px; border-radius: 4px; }
.login-brand__progress { position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: var(--rb-ink); transform-origin: left; animation: preview-progress 4s linear both; }
.login-brand__progress.is-static { animation: none; }
.login-brand__captions { display: grid; margin-top: 12px; min-height: 21px; }
.login-brand__captions p { grid-area: 1 / 1; margin: 0; color: var(--rb-muted); font-size: 12px; line-height: 1.7; opacity: 0; transition: opacity 180ms; }
.login-brand__captions .is-active { opacity: 1; }
@keyframes preview-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (min-width: 768px) and (max-width: 1023px) {
  .login-brand { padding: 0 8px; }
  .login-brand__heading { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 22px; }
  .login-brand__identity { margin: 0; gap: 10px; }
  .login-brand__identity p { font-size: 14px; }
  .login-brand__intro { padding-left: 22px; border-left: 1px solid var(--rb-border); font-size: 14px; line-height: 1.8; }
  .login-brand__demo { display: none; }
}
@media (max-width: 767px) { .login-brand { display: none; } }
@media (prefers-reduced-motion: reduce) { .login-brand__progress { animation: none; } }
</style>
