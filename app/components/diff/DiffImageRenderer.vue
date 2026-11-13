<script setup lang="ts">
import { computed } from 'vue'

import type { InlineDiffChunk } from '~~/shared/diff/rich-text-diff'
import { normalizeImageAlignment, type RichTextNode } from '~~/shared/editor/document'
import DiffInlineChunk from './DiffInlineChunk.vue'
import { buildImageDiffDisplayFromNodes } from './image-diff-display'

const props = defineProps<{
  baseNode: RichTextNode | null
  targetNode: RichTextNode | null
  chunks: InlineDiffChunk[]
  side: 'base' | 'target'
}>()

const node = computed(() => (props.side === 'base' ? props.baseNode : props.targetNode))
const imageAlignment = computed(() => normalizeImageAlignment(node.value?.attrs?.align))
const imageDiffDisplay = computed(() => buildImageDiffDisplayFromNodes(props.baseNode, props.targetNode))
const imagePreview = computed(() => (
  props.side === 'base' ? imageDiffDisplay.value.base : imageDiffDisplay.value.target
))
const imagePreviewStyle = computed(() => {
  const preview = imagePreview.value
  if (!preview) return undefined
  return {
    width: `${preview.previewWidth}px`,
    height: `${preview.previewHeight}px`,
  }
})
const imageCaptionStyle = computed(() => {
  const preview = imagePreview.value
  return preview ? { width: `${preview.previewWidth}px` } : undefined
})
const imageSizeLabel = computed(() => {
  const preview = imagePreview.value
  return preview ? `${preview.width} × ${preview.height} px` : ''
})
</script>

<template>
  <figure
    v-if="node"
    class="diff-block__image"
    :class="{ 'diff-block__image--size-changed': imageDiffDisplay.sizeChanged }"
    :data-image-align="imageAlignment"
    :data-diff-side="side"
  >
    <div v-if="imageDiffDisplay.sizeChanged" class="diff-block__image-size">
      <span class="diff-block__image-size-label">{{ side === 'base' ? '原尺寸' : '新尺寸' }}</span>
      <span>{{ imageSizeLabel }}</span>
    </div>
    <img
      :src="String(node.attrs?.src ?? '')"
      :alt="String(node.attrs?.alt ?? '图片')"
      :style="imagePreviewStyle"
      :data-image-width="imagePreview?.width"
      :data-image-height="imagePreview?.height"
    />
    <figcaption :style="imageCaptionStyle">
      <DiffInlineChunk
        v-for="(chunk, index) in chunks"
        :key="index"
        :chunk="chunk"
        :side="side"
      />
    </figcaption>
  </figure>
</template>
