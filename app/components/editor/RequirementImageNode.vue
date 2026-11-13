<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { nodeViewProps, NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { AlignCenter, AlignLeft, AlignRight, Copy, Trash2 } from 'lucide-vue-next'
import { gsap } from 'gsap'
import {
  BingButton,
  BingIcon,
  BingResizable,
  useBingToast,
  type BingResizableDirection,
  type BingResizableResolvedSize,
} from '@moubing/bing-ui'

import {
  normalizeImageAlignment,
  type ImageAlignment,
} from '~~/shared/editor/document'
import {
  DEFAULT_IMAGE_DISPLAY_SIZE,
  fitImageDisplaySize,
  hasMatchingImageRatio,
} from './image-display-size'
import { startImageAlignmentMotion } from './image-alignment-motion'
import { copyImageToClipboard } from './image-clipboard'
import { DOCUMENT_LAYOUT_MOTION_META } from './document-layout-motion'
import { EDITOR_IMAGE_RESIZE_EVENT, EDITOR_LAYOUT_MOTION_FRAME_EVENT } from './editor-layout-events'
import { captureFollowingBlockReflow } from './image-delete-reflow'
import { editorVisualStateKey } from './editor-visual-state'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import {
  claimUploadedImageTransition,
  type UploadedImageTransitionHandle,
} from './uploaded-image-transition'

type FlipPlugin = typeof import('gsap/Flip')['Flip']

let flipPluginReady: Promise<FlipPlugin> | null = null
let loadedFlipPlugin: FlipPlugin | null = null

function ensureFlipPlugin() {
  flipPluginReady ??= import('gsap/Flip').then(({ Flip }) => {
    gsap.registerPlugin(Flip)
    loadedFlipPlugin = Flip
    return Flip
  })
  return flipPluginReady
}

const props = defineProps(nodeViewProps)
const toast = useBingToast()
const mediaRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const frameRef = ref<HTMLElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
const transitionPreviewRef = ref<HTMLImageElement | null>(null)
const actionsRef = ref<HTMLElement | null>(null)
const maxImageWidth = ref<number>()
const deleting = ref(false)
const copying = ref(false)
const hovered = ref(false)
const focused = ref(false)
const resizing = ref(false)
const editorActive = inject(editorVisualStateKey, computed(() => true))
const controlsActive = computed(() => editorActive.value && props.editor.isEditable
  && (hovered.value || focused.value || props.selected || resizing.value || copying.value))
watch(resizing, active => {
  if (!props.editor.isDestroyed) {
    props.editor.view.dom.dispatchEvent(new CustomEvent(EDITOR_IMAGE_RESIZE_EVENT, { detail: active }))
  }
}, { flush: 'sync' })
let uploadedImageTransition: UploadedImageTransitionHandle | null = claimUploadedImageTransition(
  String(props.node.attrs.diffId ?? ''),
)
const transitionPreviewUrl = ref(uploadedImageTransition?.previewUrl)
const uploadEntranceActive = ref(Boolean(uploadedImageTransition))
let mediaResizeObserver: ResizeObserver | undefined
let uploadEntranceContext: gsap.Context | null = null
let motionPreference: ReturnType<typeof gsap.matchMedia> | null = null
let alignmentTimeline: gsap.core.Timeline | null = null
let deleteTween: gsap.core.Tween | null = null
let alignmentRequest = 0
let componentMounted = false
let imageLoaded = false
let reduceMotion = false
let uploadEntranceStarted = false

const src = computed(() => String(props.node.attrs.src ?? ''))
const alt = computed(() => String(props.node.attrs.alt ?? '图片'))
const title = computed(() => String(props.node.attrs.title ?? props.node.attrs.alt ?? ''))
const diffId = computed(() => String(props.node.attrs.diffId ?? ''))
const imageAlignment = computed(() => normalizeImageAlignment(props.node.attrs.align))
const imageSize = computed(() => ({
  width: positiveNumber(props.node.attrs.width) ?? DEFAULT_IMAGE_DISPLAY_SIZE.width,
  height: positiveNumber(props.node.attrs.height) ?? DEFAULT_IMAGE_DISPLAY_SIZE.height,
}))
const resizeDirections = computed<BingResizableDirection[]>(() =>
  imageAlignment.value === 'right'
    ? ['left', 'bottom', 'bottom-left']
    : ['right', 'bottom', 'bottom-right'],
)
const alignmentActions = [
  { value: 'left' as const, label: '图片居左', icon: AlignLeft },
  { value: 'center' as const, label: '图片居中', icon: AlignCenter },
  { value: 'right' as const, label: '图片居右', icon: AlignRight },
]

function updateMaxImageWidth() {
  const width = mediaRef.value?.clientWidth ?? 0
  maxImageWidth.value = width > 0 ? width : undefined
}

onMounted(() => {
  componentMounted = true

  motionPreference = gsap.matchMedia()
  motionPreference.add('(prefers-reduced-motion: reduce)', () => {
    reduceMotion = true
    finishAlignmentMotion()
    finishDeleteMotion()
    if (imageLoaded) playUploadedImageEntrance()
    return () => {
      reduceMotion = false
    }
  })

  const image = imageRef.value
  if (image?.complete && image.naturalWidth && image.naturalHeight) {
    initializeImageSize(image)
    imageLoaded = true
  }
  if (imageLoaded) playUploadedImageEntrance()
})

useActiveVisualEffect(() => controlsActive.value, () => {
  updateMaxImageWidth()
  if (typeof ResizeObserver !== 'undefined' && mediaRef.value) {
    mediaResizeObserver = new ResizeObserver(updateMaxImageWidth)
    mediaResizeObserver.observe(mediaRef.value)
  }
  // 窗口失焦同样结束拖拽；不依赖组件只在正常 pointerup 时发出的 resize-end。
  const endResize = () => { resizing.value = false }
  const handlePointerOut = (event: PointerEvent) => {
    if (!event.relatedTarget && (event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight)) endResize()
  }
  const handleVisibility = () => { if (document.visibilityState === 'hidden') endResize() }
  window.addEventListener('blur', endResize)
  window.addEventListener('pointerup', endResize)
  window.addEventListener('pointercancel', endResize)
  window.addEventListener('pointerout', handlePointerOut)
  document.addEventListener('visibilitychange', handleVisibility)
  return () => {
    mediaResizeObserver?.disconnect()
    window.removeEventListener('blur', endResize)
    window.removeEventListener('pointerup', endResize)
    window.removeEventListener('pointercancel', endResize)
    window.removeEventListener('pointerout', handlePointerOut)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
})
watch(editorActive, active => {
  if (active) return
  hovered.value = focused.value = resizing.value = false
  finishAlignmentMotion()
  if (deleteTween) finishDeleteMotion()
  else if (deleting.value) removeImageNode()
  uploadEntranceContext?.revert()
  finishUploadedImageEntrance()
})

function leaveFocus(event: FocusEvent) {
  focused.value = event.relatedTarget instanceof Node && Boolean(getImageNodeElement()?.contains(event.relatedTarget))
}

onBeforeUnmount(() => {
  resizing.value = false
  componentMounted = false
  alignmentRequest += 1
  killAlignmentMotion()
  killDeleteMotion()
  mediaResizeObserver?.disconnect()
  uploadEntranceContext?.revert()
  motionPreference?.revert()
  motionPreference = null
  uploadedImageTransition?.release()
  uploadedImageTransition = null
})

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function initializeImageSize(image: HTMLImageElement) {
  if (!image.naturalWidth || !image.naturalHeight) return

  if (hasMatchingImageRatio(
    props.node.attrs.width,
    props.node.attrs.height,
    image.naturalWidth,
    image.naturalHeight,
  )) return

  updateMaxImageWidth()
  const size = fitImageDisplaySize(
    image.naturalWidth,
    image.naturalHeight,
    maxImageWidth.value,
  )
  // 小图经过最小尺寸约束后可能不再匹配天然比例；相同尺寸不重复写入撤销栈。
  if (props.node.attrs.width === size.width && props.node.attrs.height === size.height) return
  props.updateAttributes(size)
}

function handleImageLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  initializeImageSize(image)
  imageLoaded = true
  if (componentMounted) playUploadedImageEntrance()
}

function finishUploadedImageEntrance() {
  if (!uploadedImageTransition) return

  const transition = uploadedImageTransition
  uploadedImageTransition = null
  uploadEntranceActive.value = false
  transitionPreviewUrl.value = undefined

  void nextTick(() => {
    if (imageRef.value) {
      gsap.set(imageRef.value, { clearProps: 'transform,opacity,visibility' })
    }
    transition.release()
  })
}

function playUploadedImageEntrance() {
  const image = imageRef.value
  const frame = frameRef.value
  if (
    uploadEntranceStarted
    || !uploadedImageTransition
    || !imageLoaded
    || !image
    || !frame
  ) return
  uploadEntranceStarted = true

  uploadEntranceContext?.revert()
  uploadEntranceContext = gsap.context(() => {
    if (reduceMotion) {
      gsap.set(image, { autoAlpha: 1, scale: 1 })
      finishUploadedImageEntrance()
      return
    }

    const preview = transitionPreviewRef.value
    gsap.set(image, {
      autoAlpha: 0,
      scale: 0.985,
      transformOrigin: '50% 50%',
    })
    if (preview) gsap.set(preview, { autoAlpha: 1 })

    const timeline = gsap.timeline({ onComplete: finishUploadedImageEntrance })
    timeline.to(image, {
      autoAlpha: 1,
      scale: 1,
      duration: 0.26,
      ease: 'power2.out',
      overwrite: 'auto',
    }, 0)
    if (preview) {
      timeline.to(preview, {
        autoAlpha: 0,
        duration: 0.18,
        ease: 'power1.out',
        overwrite: 'auto',
      }, 0.06)
    }
  }, frame)
}

function commitSize(size: BingResizableResolvedSize) {
  props.updateAttributes({
    width: Math.round(size.width),
    height: Math.round(size.height),
  })
}

function openPreview() {
  props.editor.view.dom.dispatchEvent(
    new CustomEvent('requirement-image-preview', {
      bubbles: true,
      detail: { diffId: diffId.value, src: src.value },
    }),
  )
}

function selectImage() {
  if (!props.editor.isEditable) return
  const position = props.getPos()
  if (typeof position !== 'number') return
  props.editor.chain().focus().setNodeSelection(position).run()
}

async function copyImage() {
  if (copying.value || deleting.value) return
  copying.value = true
  const id = toast.loading({ message: '正在复制图片', position: 'top-center' })
  try {
    await copyImageToClipboard(imageRef.value)
    if (toast.getToasts().some(item => item.id === id)) toast.success({ id, title: '图片已复制', position: 'top-center' })
  } catch (error) {
    if (toast.getToasts().some(item => item.id === id)) toast.error({ id,
      title: '复制图片失败',
      message: error instanceof Error ? error.message : '请稍后重试。',
      position: 'top-center', duration: 6500,
    })
  } finally {
    copying.value = false
  }
}

function getImageNodeElement() {
  return stageRef.value?.closest<HTMLElement>('.requirement-image') ?? null
}

function getAlignmentTargets() {
  const imageNode = getImageNodeElement()
  const caption = imageNode?.querySelector<HTMLElement>('.requirement-image__caption') ?? null
  return [stageRef.value, caption, actionsRef.value]
    .filter((element): element is HTMLElement => Boolean(element))
}

function clearAlignmentMotionStyles(targets = getAlignmentTargets()) {
  if (targets.length) gsap.set(targets, { clearProps: 'transform' })
  if (actionsRef.value) gsap.set(actionsRef.value, { clearProps: 'transition' })
}

function notifyEditorLayoutMotionFrame() {
  if (!componentMounted || props.editor.isDestroyed) return
  props.editor.view.dom.dispatchEvent(new Event(EDITOR_LAYOUT_MOTION_FRAME_EVENT))
}

function killAlignmentMotion() {
  const timeline = alignmentTimeline
  alignmentTimeline = null
  timeline?.kill()
  clearAlignmentMotionStyles()
}

function finishAlignmentMotion() {
  const timeline = alignmentTimeline
  alignmentTimeline = null
  if (!timeline) return

  timeline.progress(1)
  timeline.kill()
}

function killDeleteMotion() {
  const tween = deleteTween
  deleteTween = null
  tween?.kill()
}

function finishDeleteMotion() {
  const tween = deleteTween
  deleteTween = null
  if (!tween) return

  tween.progress(1)
  tween.kill()
}

function removeImageNode() {
  const imageNode = getImageNodeElement()
  const followingBlockReflow = editorActive.value && !reduceMotion && imageNode && loadedFlipPlugin
    ? captureFollowingBlockReflow(imageNode, loadedFlipPlugin)
    : null

  const chain = props.editor
    .chain()
    .setMeta(DOCUMENT_LAYOUT_MOTION_META, false)
    .command(({ tr }) => {
      const position = props.getPos()
      if (typeof position !== 'number') return false

      tr.delete(position, position + props.node.nodeSize)
      return true
    })
  if (editorActive.value) chain.focus()
  const deleted = chain.run()
  if (deleted) followingBlockReflow?.play()
}

function deleteImage() {
  if (!props.editor.isEditable || deleting.value) return

  if (reduceMotion) {
    removeImageNode()
    return
  }

  deleting.value = true
  alignmentRequest += 1
  finishAlignmentMotion()
  void startImageDeleteMotion()
}

async function startImageDeleteMotion() {
  try {
    await ensureFlipPlugin()
  } catch {
    // 图片本身的退场不依赖 Flip；插件加载失败时仍然允许正常删除。
  }

  if (!componentMounted || !deleting.value) return

  const imageNode = getImageNodeElement()
  if (!editorActive.value || reduceMotion || !imageNode) {
    removeImageNode()
    return
  }

  deleteTween = gsap.to(imageNode, {
    autoAlpha: 0,
    y: -6,
    scale: 0.985,
    transformOrigin: '50% 50%',
    duration: 0.18,
    ease: 'power2.in',
    overwrite: 'auto',
    onComplete: () => {
      deleteTween = null
      if (componentMounted) removeImageNode()
    },
  })
}

function setImageAlignment(alignment: ImageAlignment) {
  if (
    !props.editor.isEditable
    || deleting.value
    || imageAlignment.value === alignment
  ) return

  const request = ++alignmentRequest
  void animateImageAlignment(alignment, request)
}

async function animateImageAlignment(alignment: ImageAlignment, request: number) {
  let Flip: FlipPlugin
  try {
    Flip = await ensureFlipPlugin()
  } catch {
    if (componentMounted && request === alignmentRequest && !deleting.value) {
      props.updateAttributes({ align: alignment })
    }
    return
  }

  if (!componentMounted || request !== alignmentRequest || deleting.value) return

  finishAlignmentMotion()
  const targets = getAlignmentTargets()
  if (!editorActive.value || reduceMotion || !targets.length) {
    props.updateAttributes({ align: alignment })
    return
  }

  if (actionsRef.value) gsap.set(actionsRef.value, { transition: 'none' })
  const state = Flip.getState(targets, { simple: true })
  props.updateAttributes({ align: alignment })
  await nextTick()

  if (!componentMounted || !editorActive.value || request !== alignmentRequest || deleting.value) {
    clearAlignmentMotionStyles(targets)
    return
  }

  let timeline: gsap.core.Timeline
  timeline = startImageAlignmentMotion(Flip, state, {
    onFrame: notifyEditorLayoutMotionFrame,
    onFinish: () => {
      if (alignmentTimeline === timeline) alignmentTimeline = null
      clearAlignmentMotionStyles(targets)
    },
  })
  alignmentTimeline = timeline
}

</script>

<template>
  <NodeViewWrapper
    as="figure"
    class="requirement-image"
    :class="{
      'requirement-image--selected': selected,
      'requirement-image--readonly': !editor.isEditable,
      'requirement-image--deleting': deleting,
    }"
    :data-image-diff-id="diffId"
    :data-image-align="imageAlignment"
    :aria-busy="deleting ? 'true' : undefined"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @focusin="focused = true"
    @focusout="leaveFocus"
  >
    <div ref="mediaRef" class="requirement-image__media" contenteditable="false" data-drag-handle>
      <div ref="stageRef" class="requirement-image__stage">
        <BingResizable
          :size="imageSize"
          :min-width="120"
          :min-height="80"
          :max-width="maxImageWidth"
          :directions="controlsActive ? resizeDirections : []"
          :disabled="!editor.isEditable"
          lock-aspect-ratio
          :show-size="controlsActive"
          aria-label="调整图片尺寸"
          @update:size="commitSize"
          @resize-start="resizing = true"
          @resize-end="resizing = false"
        >
          <div ref="frameRef" class="requirement-image__frame">
            <button
              type="button"
              class="requirement-image__preview-trigger"
              aria-label="预览图片"
              title="点击预览图片"
              @mousedown="selectImage"
              @click.stop="openPreview"
              @keydown.delete.stop.prevent="deleteImage"
              @keydown.backspace.stop.prevent="deleteImage"
            >
              <img
                ref="imageRef"
                :class="{ 'requirement-image__remote--entering': uploadEntranceActive }"
                :src="src"
                :alt="alt"
                :title="title"
                decoding="async"
                draggable="false"
                @load="handleImageLoad"
              />
            </button>
            <img
              v-if="transitionPreviewUrl"
              ref="transitionPreviewRef"
              class="requirement-image__transition-preview"
              :src="transitionPreviewUrl"
              alt=""
              aria-hidden="true"
              draggable="false"
            />
          </div>
        </BingResizable>

        <div
          v-if="controlsActive"
          ref="actionsRef"
          class="requirement-image__actions"
          role="toolbar"
          aria-label="图片布局工具"
          contenteditable="false"
        >
          <BingButton
            v-for="action in alignmentActions"
            :key="action.value"
            class="requirement-image__alignment"
            :class="{ 'requirement-image__alignment--active': imageAlignment === action.value }"
            size="sm"
            variant="ghost"
            rounded="sm"
            :disabled="deleting"
            :aria-label="action.label"
            :aria-pressed="imageAlignment === action.value"
            :title="action.label"
            @mousedown.stop.prevent
            @click.stop.prevent="setImageAlignment(action.value)"
          >
            <template #prefix>
              <BingIcon :icon="action.icon" :size="15" decorative />
            </template>
          </BingButton>

          <span class="requirement-image__actions-divider" aria-hidden="true" />

          <BingButton
            class="requirement-image__copy"
            size="sm"
            variant="ghost"
            rounded="sm"
            :loading="copying"
            :disabled="deleting"
            :throttle="false"
            aria-label="复制图片"
            title="复制图片"
            @mousedown.stop.prevent
            @click.stop.prevent="copyImage"
          >
            <template #prefix>
              <BingIcon :icon="Copy" :size="15" decorative />
            </template>
          </BingButton>

          <BingButton
            class="requirement-image__delete"
            size="sm"
            variant="ghost"
            rounded="sm"
            :disabled="deleting"
            aria-label="删除图片"
            title="删除图片"
            @mousedown.stop.prevent
            @click.stop.prevent="deleteImage"
          >
            <template #prefix>
              <BingIcon :icon="Trash2" :size="15" decorative />
            </template>
          </BingButton>
        </div>
      </div>
    </div>

    <NodeViewContent
      as="figcaption"
      class="requirement-image__caption"
      :style="{ width: `${imageSize.width}px` }"
    />
  </NodeViewWrapper>
</template>
