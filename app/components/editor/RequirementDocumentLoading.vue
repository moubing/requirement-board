<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ pending: boolean }>()
const visible = ref(false)
const paragraphs = [[100, 94, 72], [100, 88, 96, 64], [100, 92, 78]]

// 与项目动态保持一致：快请求不闪烁，结束后立即交还操作，不等待退场动画。
onMounted(() => {
  watch(() => props.pending, (pending, _previous, onCleanup) => {
    visible.value = false
    if (!pending) return
    const timer = setTimeout(() => { visible.value = true }, 150)
    onCleanup(() => clearTimeout(timer))
  }, { immediate: true })
})
</script>

<template>
  <Transition name="document-loading">
    <div v-if="visible" class="document-loading" role="status" aria-live="polite" :aria-hidden="!pending">
      <span class="visually-hidden">正在加载文档…</span>
      <div class="document-loading__skeleton" aria-hidden="true">
        <div class="document-loading__viewport">
          <div class="document-loading__document">
            <div class="document-loading__byline">
              <span class="document-loading__shape document-loading__type" />
              <span class="document-loading__shape document-loading__author" />
            </div>
            <div class="document-loading__shape document-loading__title" />
            <div class="document-loading__meta">
              <span class="document-loading__shape" />
              <span class="document-loading__shape" />
            </div>
            <div v-for="(lines, index) in paragraphs" :key="index" class="document-loading__section">
              <div class="document-loading__shape document-loading__heading" :style="{ width: `${index === 1 ? 24 : 32}%` }" />
              <div class="document-loading__paragraph">
                <span v-for="(width, line) in lines" :key="line" class="document-loading__shape document-loading__line" :style="{ width: `${width}%` }" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.document-loading { position: absolute; inset: var(--requirement-loading-inset, 0px) 0 0; z-index: 100; overflow: hidden; background: var(--bing-surface-solid); cursor: progress; }
.document-loading__skeleton { display: flex; flex-direction: column; height: 100%; animation: document-loading-pulse 1800ms ease-in-out infinite; }
.document-loading__shape { display: block; flex-shrink: 0; border-radius: 4px; background: color-mix(in srgb, var(--bing-muted) 14%, var(--bing-surface-solid)); }
.document-loading__viewport { flex: 1; min-height: 0; overflow: hidden; }
.document-loading__document { width: 100%; max-width: var(--requirement-document-width, 880px); margin-inline: auto; padding: 32px 32px 64px; }
.document-loading__byline { display: flex; align-items: center; gap: 12px; height: 20px; margin-bottom: 16px; }
.document-loading__type { width: 44px; height: 18px; }
.document-loading__author { width: 96px; height: 10px; }
.document-loading__title { width: 60%; max-width: 420px; height: 30px; margin-bottom: 18px; border-radius: 5px; }
.document-loading__meta { display: flex; gap: 16px; }
.document-loading__meta .document-loading__shape { width: 104px; height: 10px; }
.document-loading__meta .document-loading__shape + .document-loading__shape { width: 132px; }
.document-loading__section { margin-top: 40px; }
.document-loading__heading { max-width: 240px; height: 20px; margin-bottom: 24px; }
.document-loading__paragraph { display: grid; gap: 18px; }
.document-loading__line { height: 12px; }
.document-loading-enter-active, .document-loading-leave-active { transition: opacity 100ms ease; }
.document-loading-enter-from, .document-loading-leave-to { opacity: 0; }
.document-loading-leave-active { pointer-events: none; }
@keyframes document-loading-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@media (min-width: 701px) {
  .document-loading__document { padding-left: 44px; padding-right: 20px; }
}
@media (max-width: 700px) {
  .document-loading__document { padding: 24px 16px 60px; }
  .document-loading__title { width: 78%; height: 26px; }
}
@media (prefers-reduced-motion: reduce) {
  .document-loading__skeleton { animation: none; }
  .document-loading-enter-active, .document-loading-leave-active { transition: none; }
}
</style>
