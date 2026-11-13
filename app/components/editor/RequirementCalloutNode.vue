<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3'
import { BingDropDown } from '@moubing/bing-ui'
import { displayCalloutTone, calloutToneDetails, type CalloutTone } from '~~/shared/editor/callout'
import { calloutIcons } from './callout-presentation'
import { editorEditableStateKey } from './editor-visual-state'
import { setCalloutTone } from './callout-commands'
import CalloutToneItems from './CalloutToneItems.vue'

const props = defineProps(nodeViewProps)
const editable = inject(editorEditableStateKey, computed(() => props.editor.isEditable))
const tone = computed(() => displayCalloutTone(props.node.attrs.tone))
const detail = computed(() => calloutToneDetails[tone.value])
const open = ref(false)
watch(editable, value => { if (!value) open.value = false })
function selectTone(value: CalloutTone) {
  if (!editable.value) return
  setCalloutTone(props.editor, props.node.attrs.diffId, value)
  props.editor.view.focus()
}
</script>

<template>
  <NodeViewWrapper as="section" class="requirement-callout" data-requirement-callout=""
    :data-diff-id="node.attrs.diffId" :data-tone="tone" :aria-label="detail.label">
    <div class="requirement-callout__icon" contenteditable="false">
      <BingDropDown v-if="editable" v-model:open="open" trigger="click" placement="bottom-start" :min-width="250" aria-label="切换提示类型">
        <template #trigger="{ triggerProps }">
          <button v-bind="triggerProps" type="button" class="requirement-callout__trigger"
            :aria-label="`${detail.label}：切换提示类型`" @mousedown.prevent>
            <component :is="calloutIcons[tone]" :size="18" aria-hidden="true" />
          </button>
        </template>
        <CalloutToneItems :current="tone" @select="selectTone" />
      </BingDropDown>
      <component :is="calloutIcons[tone]" v-else :size="18" aria-hidden="true" />
    </div>
    <NodeViewContent as="div" class="requirement-callout__content"
      :data-empty="node.content.size === 0 ? '' : undefined" :data-placeholder="editable ? detail.placeholder : undefined" />
  </NodeViewWrapper>
</template>
