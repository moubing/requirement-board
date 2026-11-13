<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { BingButton, BingIcon, BingSelect, BingTabs, type BingTabValue } from '@moubing/bing-ui'
import { ExternalLink, RotateCcw } from 'lucide-vue-next'
import RichRequirementEditor from '~/components/editor/RichRequirementEditor.vue'
import RichTextDiffViewer from '~/components/diff/RichTextDiffViewer.vue'
import { afterNextPaint } from '~/utils/after-paint'
import { createDemoDocuments, DEMO_IMAGE_SOURCES, DEMO_TITLE } from '~~/shared/demo/document'
import { cloneRichTextDocument } from '~~/shared/editor/document'
import { richTextContentKey } from '~~/shared/editor/content-equality'
import type { RevertChangePayload } from '~~/shared/diff/revert-draft-change'

definePageMeta({ name: 'demo', keepalive: false })
useHead({ title: '游客体验 · 文档看板', meta: [{ name: 'description', content: '无需注册，通过节点导览体验富文本编辑、版本比较与局部恢复。修改仅在当前页面生效。' }] })

const { revisions, draft: initialDraft } = createDemoDocuments()
const draft = shallowRef(initialDraft)
const baseline = revisions[2]!
const baselineKey = richTextContentKey(baseline.content)
const modified = computed(() => richTextContentKey(draft.value) !== baselineKey)
const editor = ref<InstanceType<typeof RichRequirementEditor> | null>(null)
const generation = ref(0)
const selectedView = ref<BingTabValue>('body')
const view = ref<BingTabValue>('body')
const comparisonOpened = ref(false)
const baseId = ref('v3')
const targetId = ref('draft')
const message = ref('')
const base = computed(() => revisions.find(item => item.id === baseId.value) ?? baseline)
const target = computed(() => revisions.find(item => item.id === targetId.value))
const targetDocument = computed(() => target.value?.content ?? draft.value)
const versionOptions = revisions.map(({ id, label, note }) => ({ value: id, label, detail: note }))
const targetOptions = [...versionOptions, { value: 'draft', label: '当前临时内容', detail: '只存在于此页面；刷新、离开或重置后恢复 v3。' }]
const config = useRuntimeConfig()
const sourceUrl = computed(() => {
  const value = String(config.public.demoSourceUrl ?? '')
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password) return url.href } catch { /* 使用默认的项目源码地址。 */ }
  return 'https://github.com/moubing/requirement-board'
})
let cancelView: (() => void) | undefined
function selectView(value: BingTabValue) {
  selectedView.value = value
  cancelView?.()
  cancelView = afterNextPaint(() => { view.value = value; if (value === 'diff') comparisonOpened.value = true })
}
function reset() {
  cancelView?.()
  draft.value = cloneRichTextDocument(baseline.content)
  generation.value++ // 重建普通编辑器，同时清空旧撤销栈、选区、目录及比较视图状态。
  baseId.value = 'v3'; targetId.value = 'draft'
  selectedView.value = view.value = 'body'
  comparisonOpened.value = false
  message.value = '已恢复初始示例，临时修改和撤销记录已清空。'
}
function restore(change: RevertChangePayload) {
  if (targetId.value !== 'draft') return
  if (editor.value?.restoreChange(base.value.content, change)) message.value = '已在临时内容中恢复此处，可回到正文按 Ctrl / ⌘ Z 撤销。'
}
function keydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  event.stopPropagation()
  message.value = '游客体验不可保存版本。修改仅在当前页面生效，刷新后恢复。'
}
function pageshow(event: PageTransitionEvent) { if (event.persisted) reset() }
onMounted(() => { window.addEventListener('keydown', keydown, true); window.addEventListener('pageshow', pageshow) })
onBeforeUnmount(() => { cancelView?.(); window.removeEventListener('keydown', keydown, true); window.removeEventListener('pageshow', pageshow) })
</script>

<template>
  <main class="demo-page">
    <header class="demo-toolbar">
      <div class="demo-heading">
        <h1>{{ DEMO_TITLE }}</h1>
        <p id="demo-save-hint" class="demo-notice"><strong>游客体验</strong><span>修改仅本页生效，刷新后恢复</span><span>不可保存或上传图片</span></p>
        <a :href="sourceUrl" target="_blank" rel="noopener noreferrer" class="demo-source">查看项目源码<BingIcon :icon="ExternalLink" :size="14" decorative /></a>
      </div>
      <div class="demo-controls">
        <BingTabs :model-value="selectedView" :items="[{ value: 'body', label: '正文' }, { value: 'diff', label: '版本比较' }]" variant="soft" aria-label="示例视图" @update:model-value="selectView" />
        <span class="demo-change-state">{{ modified ? '有临时修改' : '与示例 v3 一致' }}</span>
        <div class="demo-actions">
          <BingButton size="sm" variant="secondary" @click="reset"><template #prefix><BingIcon :icon="RotateCcw" :size="16" decorative /></template>重置示例</BingButton>
          <BingButton disabled size="sm" variant="secondary" aria-describedby="demo-save-hint">保存版本</BingButton>
        </div>
      </div>
    </header>
    <p v-if="message" class="demo-feedback" role="status">{{ message }}</p>
    <ClientOnly>
      <RichRequirementEditor v-show="view === 'body'" :key="generation" ref="editor" v-model="draft" :active="view === 'body'"
        :allow-image-upload="false" :allowed-image-sources="DEMO_IMAGE_SOURCES" :allow-selection-history="false" @error="message = $event" />
      <RichTextDiffViewer v-if="comparisonOpened" v-show="view === 'diff'" :key="`diff-${generation}`" class="demo-diff"
        :base="base.content" :target="targetDocument" :base-label="base.label" :target-label="target?.label ?? '当前临时内容'"
        :active="view === 'diff'" :comparison-key="`${baseId}:${targetId}`" :revertible="targetId === 'draft'" @revert-change="restore">
        <template #versions>
          <div class="demo-versions">
            <BingSelect v-model="baseId" :options="versionOptions" :searchable="false" :clearable="false" aria-label="基准示例版本" />
            <span>比较</span>
            <BingSelect v-model="targetId" :options="targetOptions" :searchable="false" :clearable="false" aria-label="目标示例版本" />
          </div>
        </template>
      </RichTextDiffViewer>
      <template #fallback><p class="demo-loading" role="status">正在准备示例编辑器…</p></template>
    </ClientOnly>
  </main>
</template>

<style scoped>
.demo-page { max-width: 1600px; margin-inline: auto; padding: 0 24px 16px; }
.demo-toolbar { position: sticky; top: 0; z-index: 30; display: grid; gap: 8px; padding-block: 10px 8px; background: var(--rb-soft); }
.demo-heading { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 4px 20px; }
.demo-heading h1 { margin: 0; font-size: 18px; line-height: 1.5; }
.demo-notice { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 0; color: var(--rb-muted); font-size: 12px; line-height: 1.5; }
.demo-notice strong { color: var(--rb-body-accent); }
.demo-source { display: inline-flex; align-items: center; gap: 6px; color: var(--rb-ink); font-size: 12px; white-space: nowrap; text-underline-offset: 4px; }
.demo-source:focus-visible { outline: 2px solid var(--bing-focus-ring); outline-offset: 4px; }
.demo-controls { display: flex; align-items: center; gap: 16px; }
.demo-actions { display: flex; gap: 8px; margin-left: auto; }
.demo-change-state { font-size: 12px; color: var(--rb-muted); }
.demo-feedback { margin: 0 0 12px; padding: 8px 12px; color: var(--rb-ink); background: var(--rb-panel); border-left: 3px solid var(--rb-body-accent); font-size: 13px; }
.demo-versions { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.demo-versions > :first-child, .demo-versions > :last-child { width: 180px; max-width: 100%; }
.demo-loading { padding: 32px; text-align: center; }
@media (max-width: 700px) {
  .demo-page { padding-inline: 12px; }
  .demo-heading { grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }
  .demo-notice { grid-column: 1 / -1; grid-row: 2; gap: 2px 8px; }
  .demo-source { grid-column: 2; grid-row: 1; }
  .demo-versions { width: 100%; }
  .demo-versions > :first-child, .demo-versions > :last-child { width: auto; flex: 1 1 110px; min-width: 0; }
}
@media (max-width: 560px) {
  .demo-controls { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 8px; }
  .demo-change-state { text-align: right; font-size: 11px; }
  .demo-actions { grid-column: 1 / -1; }
}
</style>
