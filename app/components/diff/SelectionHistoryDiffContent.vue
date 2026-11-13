<script setup lang="ts">
import { computed } from 'vue'

import { selectedTaskItems, type SelectionHistorySegmentDiff } from '~~/shared/diff/selection-history'
import DiffImageRenderer from './DiffImageRenderer.vue'
import DiffInlineChunk from './DiffInlineChunk.vue'
import ReadonlyCallout from '../editor/ReadonlyCallout.vue'
import ReadonlyCodeBlock from '../editor/ReadonlyCodeBlock.vue'
import { calloutToneChange } from '~~/shared/editor/callout'
import { containsTaskItems } from '~~/shared/editor/task-list'
import { normalizeDocument, type DiffBlockPair } from '~~/shared/diff/rich-text-diff'
import DiffBlockRenderer from './DiffBlockRenderer.vue'
import TaskCheckbox from '../editor/TaskCheckbox.vue'

const props = defineProps<{
  segment: SelectionHistorySegmentDiff
  side: 'base' | 'target'
}>()

const node = computed(() => (
  props.side === 'base' ? props.segment.baseNode : props.segment.targetNode
))
const chunks = computed(() => (
  props.side === 'base' ? props.segment.baseChunks : props.segment.targetChunks
))
const toneChange = computed(() => calloutToneChange(props.segment.baseNode, props.segment.targetNode))
const partialTasks = computed(() => {
  if (!containsTaskItems(node.value) || !node.value) return null
  const fullText = normalizeDocument({ type: 'doc', content: [node.value] })[0]?.text
  if (chunks.value.map(chunk => chunk.value).join('') === fullText) return null
  const segment = props.segment
  return {
    base: selectedTaskItems(segment.baseNode, segment.baseStart ?? 0, segment.baseEnd ?? 0, segment.wholeBlock),
    target: selectedTaskItems(segment.targetNode, segment.targetStart ?? 0, segment.targetEnd ?? 0, segment.wholeBlock),
  }
})
const taskSummaries = computed(() => (partialTasks.value?.[props.side] ?? []).map((task, index) => ({
  id: String(task.attrs?.diffId ?? index), checked: task.attrs?.checked === true,
})))
const taskPair = computed<DiffBlockPair | null>(() => {
  if (!containsTaskItems(node.value)) return null
  // 局部选中子任务时使用子项状态；多个条目的局部范围保留原文字 Diff，另列状态。
  if (partialTasks.value && (partialTasks.value[props.side].length !== 1 || partialTasks.value.base.length > 1 || partialTasks.value.target.length > 1)) return null
  const base = partialTasks.value ? partialTasks.value.base[0] : props.segment.baseNode
  const target = partialTasks.value ? partialTasks.value.target[0] : props.segment.targetNode
  return {
    id: props.segment.id,
    status: props.segment.status === 'introduced' ? 'inserted' : props.segment.status,
    base: base ? normalizeDocument({ type: 'doc', content: [base] })[0] ?? null : null,
    target: target ? normalizeDocument({ type: 'doc', content: [target] })[0] ?? null : null,
    baseChunks: props.segment.baseChunks, targetChunks: props.segment.targetChunks,
  }
})
</script>

<template>
  <DiffBlockRenderer v-if="taskPair" :pair="taskPair" :side="side" />
  <div v-else-if="taskSummaries.length">
    <div class="selection-history-diff__task-states">
      <TaskCheckbox v-for="task in taskSummaries" :key="task.id" :checked="task.checked" />
    </div>
    <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
  </div>
  <DiffImageRenderer
    v-else-if="node?.type === 'image'"
    :base-node="segment.baseNode"
    :target-node="segment.targetNode"
    :chunks="chunks"
    :side="side"
  />
  <div v-else-if="node?.type === 'callout'">
    <div v-if="toneChange" class="diff-block__tone-change">{{ toneChange }}</div>
    <ReadonlyCallout :tone="node.attrs?.tone">
      <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
    </ReadonlyCallout>
  </div>
  <div v-else-if="node?.type === 'detailsSummary'" class="requirement-details requirement-details--diff is-open">
    <div class="requirement-details__summary">
      <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
      <span v-if="!chunks.length" class="requirement-details__placeholder">折叠块标题</span>
    </div>
  </div>
  <ReadonlyCodeBlock v-else-if="node?.type === 'codeBlock'" :language="node.attrs?.language as string | undefined" :title="node.attrs?.title as string | undefined" :text="node.content?.map(child => child.text ?? '').join('') ?? ''">
    <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
  </ReadonlyCodeBlock>
  <div v-else-if="node?.type === 'heading'" class="diff-block">
    <component :is="`h${node.attrs?.level ?? 2}`" class="diff-block__text" :data-diff-id="node.attrs?.diffId">
      <DiffInlineChunk v-for="(chunk, index) in chunks" :key="index" :chunk="chunk" :side="side" />
    </component>
  </div>
  <span v-else-if="chunks.length">
    <DiffInlineChunk
      v-for="(chunk, chunkIndex) in chunks"
      :key="chunkIndex"
      :chunk="chunk"
      :side="side"
    />
  </span>
  <span v-else class="selection-history-diff__empty">（无内容）</span>
</template>
