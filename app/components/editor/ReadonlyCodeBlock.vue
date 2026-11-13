<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BingScrollbar } from '@moubing/bing-ui'
import CodeBlockHeader from './CodeBlockHeader.vue'
import { CodeHighlightTask, type CodeColorRange, type CodeThemeMode } from './code-highlight'

const props = withDefaults(defineProps<{ language?: string | null; title?: string | null; text: string; syntax?: boolean; theme?: CodeThemeMode }>(), { syntax: false })
const root = ref<HTMLElement>()
const ranges = ref<CodeColorRange[]>([])
let highlight: CodeHighlightTask | undefined
const segments = computed(() => {
  const result: { text: string; color?: string }[] = []
  let cursor = 0
  for (const range of ranges.value) {
    if (range.from > cursor) result.push({ text: props.text.slice(cursor, range.from) })
    result.push({ text: props.text.slice(range.from, range.to), color: range.color }); cursor = range.to
  }
  if (cursor < props.text.length) result.push({ text: props.text.slice(cursor) })
  return result
})
onMounted(() => {
  if (!props.syntax) return
  highlight = new CodeHighlightTask(root.value!, () => ({ text: props.text, language: props.language ?? '', mode: props.theme }), value => { ranges.value = value })
})
watch(() => [props.text, props.language, props.theme], () => { ranges.value = []; highlight?.update() })
onBeforeUnmount(() => highlight?.destroy())
</script>

<template>
  <div ref="root" class="requirement-code-block" data-code-block="">
    <CodeBlockHeader :language="language" :title="title" :text="text" />
    <BingScrollbar horizontal :vertical="false" :focusable="false" aria-label="代码块">
      <pre class="diff-block__text"><code><slot><template v-if="ranges.length"><span v-for="(segment, index) in segments" :key="index" class="requirement-code-token" :style="{ '--code-token-color': segment.color }">{{ segment.text }}</span></template><template v-else>{{ text }}</template></slot></code></pre>
    </BingScrollbar>
  </div>
</template>
