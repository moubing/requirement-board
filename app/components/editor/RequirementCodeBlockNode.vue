<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { BingScrollbar } from '@moubing/bing-ui'
import CodeBlockHeader from './CodeBlockHeader.vue'
import { editorActiveStateKey, editorEditableStateKey } from './editor-visual-state'
import { setCodeBlockLanguage, setCodeBlockTitle } from './code-block-commands'
import { CodeHighlightTask } from './code-highlight'
import { applyCodeHighlight } from './code-highlight-decoration'

const props = defineProps(nodeViewProps)
const editable = inject(editorEditableStateKey, computed(() => props.editor.isEditable))
const active = inject(editorActiveStateKey, computed(() => true))
const root = ref<{ $el: HTMLElement }>()
const preAttributes = computed(() => { const { 'data-diff-id': _id, ...attrs } = props.HTMLAttributes; return attrs })
const owner = {}
let highlight: CodeHighlightTask | undefined
let editorDom: HTMLElement | undefined
function language(value: string) {
  if (!editable.value) return
  setCodeBlockLanguage(props.editor, props.node.attrs.diffId, value)
  props.editor.view.focus()
}
function title(value: string) {
  if (editable.value) setCodeBlockTitle(props.editor, props.node.attrs.diffId, value)
}
function compositionStart() {
  const pos = props.getPos(), selection = props.editor.state.selection
  if (pos !== undefined && selection.from > pos && selection.from < pos + props.node.nodeSize) highlight?.setComposing(true)
}
function compositionEnd() { highlight?.setComposing(false) }
onMounted(() => {
  highlight = new CodeHighlightTask(root.value!.$el, () => ({ text: props.node.textContent, language: props.node.attrs.language ?? '' }), ranges => {
    const pos = props.getPos()
    if (pos !== undefined && !props.editor.isDestroyed) applyCodeHighlight(props.editor.view, pos, owner, ranges)
  })
  highlight.setActive(active.value)
  editorDom = props.editor.view.dom
  editorDom.addEventListener('compositionstart', compositionStart)
  editorDom.addEventListener('compositionend', compositionEnd)
})
watch(() => props.node, () => highlight?.update())
watch(active, value => highlight?.setActive(value))
onBeforeUnmount(() => {
  highlight?.destroy()
  editorDom?.removeEventListener('compositionstart', compositionStart)
  editorDom?.removeEventListener('compositionend', compositionEnd)
})
</script>

<template>
  <NodeViewWrapper ref="root" class="requirement-code-block" :data-diff-id="node.attrs.diffId" data-code-block="">
    <CodeBlockHeader :language="node.attrs.language" :title="node.attrs.title" :text="node.textContent" :editable="editable" @language="language" @title="title" />
    <BingScrollbar horizontal :vertical="false" :focusable="false">
      <template #viewport="{ viewportRef, viewportAttrs }">
        <div v-bind="viewportAttrs" :ref="viewportRef" class="requirement-node-scroll__viewport" role="region" aria-label="正文代码块">
          <pre v-bind="preAttributes"><NodeViewContent as="code" :class="node.attrs.language ? `language-${node.attrs.language}` : ''" /></pre>
        </div>
      </template>
    </BingScrollbar>
  </NodeViewWrapper>
</template>
