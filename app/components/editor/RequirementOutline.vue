<script setup lang="ts">
import { gsap } from 'gsap'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Heading1, Heading2, Heading3 } from 'lucide-vue-next'
import { BingIcon, BingScrollbar } from '@moubing/bing-ui'

import {
  resolveOutlineTrackGeometry,
  type RequirementOutlineItem,
} from './requirement-outline-logic'

const props = withDefaults(defineProps<{
  items: RequirementOutlineItem[]
  activeIds: string[]
  viewportHeight: number
  headerHeight?: number
  embedded?: boolean
}>(), {
  headerHeight: 53,
})

const emit = defineEmits<{
  select: [id: string]
}>()

const listRoot = ref<HTMLElement | null>(null)
const rail = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
let reduceMotion = false
let resizeObserver: ResizeObserver | null = null
let observedListRoot: HTMLElement | null = null
let motionPreference: ReturnType<typeof gsap.matchMedia> | null = null

function syncListObserver() {
  const nextListRoot = listRoot.value
  if (!resizeObserver || nextListRoot === observedListRoot) return
  resizeObserver.disconnect()
  observedListRoot = nextListRoot
  if (observedListRoot) resizeObserver.observe(observedListRoot)
}

function updateTrack(animate = true) {
  const list = listRoot.value
  const railElement = rail.value
  const trackElement = track.value
  if (!list || !railElement || !trackElement) return

  const railRect = railElement.getBoundingClientRect()
  const geometry = resolveOutlineTrackGeometry({
    railTop: railRect.top,
    railHeight: railRect.height,
    items: Array.from(list.querySelectorAll<HTMLElement>('[data-outline-id]')).map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.dataset.outlineId ?? '',
        top: rect.top,
        bottom: rect.bottom,
      }
    }),
    activeIds: props.activeIds,
    pixelRatio: window.devicePixelRatio || 1,
  })

  gsap.killTweensOf(trackElement)
  if (!geometry) {
    if (animate && !reduceMotion) {
      gsap.to(trackElement, {
        autoAlpha: 0,
        duration: 0.14,
        ease: 'power1.out',
        overwrite: 'auto',
      })
    } else {
      gsap.set(trackElement, { autoAlpha: 0 })
    }
    return
  }

  const vars = {
    y: geometry.y,
    scaleY: geometry.scaleY,
    autoAlpha: 1,
    transformOrigin: 'top left',
  }
  if (animate && !reduceMotion) {
    gsap.to(trackElement, {
      ...vars,
      duration: 0.24,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  } else {
    gsap.set(trackElement, vars)
  }
}

watch(
  [
    () => props.items.map(item => `${item.id}:${item.level}:${item.label}`).join('|'),
    () => props.activeIds.join('|'),
  ],
  async () => {
    await nextTick()
    syncListObserver()
    updateTrack()
  },
  { flush: 'post' },
)

onMounted(async () => {
  motionPreference = gsap.matchMedia()
  motionPreference.add('(prefers-reduced-motion: reduce)', () => {
    reduceMotion = true
    updateTrack(false)
    return () => {
      reduceMotion = false
    }
  })

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateTrack())
  }

  await nextTick()
  syncListObserver()
  updateTrack(false)
})

onBeforeUnmount(() => {
  if (track.value) gsap.killTweensOf(track.value)
  resizeObserver?.disconnect()
  resizeObserver = null
  observedListRoot = null
  motionPreference?.revert()
  motionPreference = null
})
</script>

<template>
  <aside
    class="requirement-outline"
    aria-label="本页目录"
    :style="{ height: embedded ? '100%' : `${viewportHeight + headerHeight}px` }"
  >
    <slot name="navigation" />
    <header v-if="!embedded" class="requirement-outline__header" :style="{ height: `${$slots.navigation ? 40 : headerHeight}px` }">
      <strong>本页目录</strong>
      <span v-if="items.length">{{ items.length }}</span>
    </header>

    <BingScrollbar
      class="requirement-outline__scroll"
      aria-label="目录标题"
    >
      <div class="requirement-outline__body">
        <p v-if="embedded" class="requirement-outline__caption">本页目录</p>
        <nav v-if="items.length" ref="listRoot" class="requirement-outline__list" aria-label="正文标题">
          <span ref="rail" class="requirement-outline__rail" aria-hidden="true">
            <span ref="track" class="requirement-outline__track" />
          </span>
          <button
            v-for="item in items"
            :key="item.id"
            class="requirement-outline__item"
            :class="[
              `requirement-outline__item--level-${item.level}`,
              { 'requirement-outline__item--active': activeIds.includes(item.id) },
            ]"
            type="button"
            :data-outline-id="item.id"
            :title="item.label"
            :aria-label="`定位到标题：${item.label}`"
            @click="emit('select', item.id)"
          >
            <span
              class="requirement-outline__item-icon"
              aria-hidden="true"
            >
              <BingIcon
                :icon="item.level === 1 ? Heading1 : item.level === 2 ? Heading2 : Heading3"
                :size="14"
                decorative
              />
            </span>
            <span class="requirement-outline__item-label">{{ item.label }}</span>
          </button>
        </nav>
        <p v-else class="requirement-outline__empty">添加一至三级标题后自动生成</p>
      </div>
    </BingScrollbar>
  </aside>
</template>
