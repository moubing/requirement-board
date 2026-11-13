<script setup lang="ts">
import { computed, inject } from 'vue'
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3'
import { editorActiveStateKey, editorEditableStateKey } from './editor-visual-state'
import { setTaskItemChecked } from './task-list-commands'
import TaskCheckbox from './TaskCheckbox.vue'

const props = defineProps(nodeViewProps)
const editable = inject(editorEditableStateKey, computed(() => props.editor.isEditable))
const active = inject(editorActiveStateKey, computed(() => true))
const interactive = computed(() => editable.value && active.value)
function toggle(checked: boolean) {
  if (interactive.value) setTaskItemChecked(props.editor, props.node.attrs.diffId, checked)
}
</script>

<template>
  <NodeViewWrapper as="li" class="requirement-task-item" data-type="taskItem"
    :data-diff-id="node.attrs.diffId" :data-checked="node.attrs.checked === true">
    <TaskCheckbox :checked="node.attrs.checked === true" :interactive="interactive"
      :label="`${interactive ? (node.attrs.checked ? '取消勾选' : '勾选') : (node.attrs.checked ? '已勾选' : '未勾选')}：${node.firstChild?.textContent || '空任务条目'}`" @toggle="toggle" />
    <NodeViewContent as="div" class="requirement-task-item__content" />
  </NodeViewWrapper>
</template>
