<script setup lang="ts">
import { BingButton, BingCard, BingForm, BingFormItem, BingIcon, BingInput, BingSelect, BingTabs, BingTextarea, BingScrollbar, type BingFormSubmitPayload, type BingSelectModelValue } from '@moubing/bing-ui'
import { BookOpen, Bug, CircleCheck, Copy, FileText, ListChecks, LockKeyhole, PanelLeft, Pencil, Plus, Search } from 'lucide-vue-next'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType } from '#shared/documents/workflow'
import { documentTemplateInputSchema, instantiateTemplate, type DocumentTemplate } from '#shared/documents/templates'
import { cloneRichTextDocument, createEmptyDocument } from '#shared/editor/document'
import { sameVersionContent } from '#shared/editor/content-equality'
import { draftError } from '#shared/drafts/document'
import RichRequirementEditor from '~/components/editor/RichRequirementEditor.vue'
import RichTextRevisionViewer from '~/components/revision/RichTextRevisionViewer.vue'
import { templatePreview } from '~/utils/template-preview'
import { useOperationFeedback } from '../composables/use-operation-feedback'
import { createRetryableSubmission } from '../utils/retryable-submission'

useHead({ title: '模板管理 · 文档看板' })
const { data: templates, error: loadError, refresh } = await useFetch<DocumentTemplate[]>('/api/document-templates')
const feedback = useOperationFeedback()
const submission = createRetryableSubmission<{ id?: string; version?: number; input: ReturnType<typeof documentTemplateInputSchema.parse> }>()
const selected = ref<DocumentTemplate | null>(null)
const layoutRoot = ref<HTMLElement | null>(null)
const compact = ref(false)
const activePane = ref<string | number>('directory')
const search = ref('')
const filterType = ref<BingSelectModelValue>('all')
const filterSource = ref<BingSelectModelValue>('all')
const filteredTemplates = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return (templates.value ?? []).filter(item =>
    (filterType.value === 'all' || item.documentType === filterType.value)
    && (filterSource.value === 'all' || item.builtIn === (filterSource.value === 'builtin'))
    && (!query || `${item.name}\n${item.description}`.toLocaleLowerCase().includes(query)),
  )
})
const builtInCount = computed(() => filteredTemplates.value.filter(item => item.builtIn).length)
const typeIcons = { requirement: FileText, defect: Bug, instruction: BookOpen, todo: ListChecks }
const sourceOptions = [{ value: 'all', label: '全部来源' }, { value: 'builtin', label: '内置模板' }, { value: 'project', label: '项目模板' }]
const previews = computed(() => Object.fromEntries((templates.value ?? []).map(item => [item.id, templatePreview(item.contentJson)])))
let layoutObserver: ResizeObserver | undefined
onMounted(() => {
  if (!layoutRoot.value) return
  layoutObserver = new ResizeObserver(([entry]) => { compact.value = entry!.contentRect.width <= 1100 })
  layoutObserver.observe(layoutRoot.value)
})
onBeforeUnmount(() => layoutObserver?.disconnect())
const editing = ref(false), busy = ref(false), message = ref(''), editorKey = ref(0)
const formId = useId()
const model = reactive({ name: '', documentType: 'requirement' as DocumentType, description: '', contentJson: createEmptyDocument() })
const formSchema = documentTemplateInputSchema.omit({ contentJson: true })
const formModel = computed(() => ({ name: model.name, documentType: model.documentType, description: model.description }))
const baseline = ref('')
const saveConflict = ref(false), recoverable = ref(false)
const dirty = computed(() => editing.value && JSON.stringify(model) !== baseline.value)
const uploads = ref({ uploading: 0, failed: 0 })
const canSave = computed(() => !busy.value && !saveConflict.value && !uploads.value.uploading && !uploads.value.failed)
const typeOptions = DOCUMENT_TYPES.map(value => ({ value, label: DOCUMENT_TYPE_LABELS[value] }))
const typeValue = computed<BingSelectModelValue>({ get: () => model.documentType, set: value => { if (DOCUMENT_TYPES.includes(value as DocumentType)) model.documentType = value as DocumentType } })
function load(item: DocumentTemplate | null, copy = false, initial = false) {
  if (busy.value || dirty.value || uploads.value.uploading || uploads.value.failed) { message.value = '请先保存或放弃当前修改，再切换模板。'; activePane.value = 'preview'; return }
  selected.value = copy ? null : item
  editing.value = !item || copy
  Object.assign(model, { name: copy ? `${item!.name}（副本）`.slice(0, 80) : item?.name ?? '', documentType: item?.documentType ?? 'requirement', description: item?.description ?? '',
    contentJson: item ? copy ? instantiateTemplate(item.contentJson) : cloneRichTextDocument(item.contentJson) : createEmptyDocument() })
  editorKey.value++; uploads.value = { uploading: 0, failed: 0 }; message.value = ''; baseline.value = JSON.stringify(model)
  if (!initial) activePane.value = 'preview'
}
watch(filteredTemplates, value => {
  if (editing.value || busy.value || uploads.value.uploading || uploads.value.failed) return
  if (!selected.value || !value.some(item => item.id === selected.value?.id)) {
    if (value[0]) load(value[0], false, true)
    else selected.value = null
  }
}, { immediate: true })
function editSelected() { if (selected.value?.canEdit) { editing.value = true; editorKey.value++ } }
function previewSelected() {
  if (dirty.value || uploads.value.uploading || uploads.value.failed) { message.value = '请先保存或放弃当前修改，再预览模板。'; return }
  editing.value = false
}
async function discard() {
  if (submission.recover()) { message.value = '上次保存结果尚未确认，请恢复上次提交内容并重试，再放弃修改。'; return }
  const id = selected.value?.id
  await refresh()
  if (loadError.value) { message.value = '重新载入失败，当前输入已保留。'; return }
  editing.value = false
  saveConflict.value = false
  uploads.value = { uploading: 0, failed: 0 }
  load(templates.value?.find(item => item.id === id) ?? templates.value?.[0] ?? null)
}
function recoverSubmission() {
  const previous = submission.recover()
  if (previous) { Object.assign(model, previous.input); editorKey.value++; message.value = '已恢复上次提交内容，请重试确认保存结果。' }
}
async function save({ valid }: BingFormSubmitPayload) {
  if (!valid || !canSave.value) return
  if (selected.value?.canEdit && !dirty.value && !submission.recover()) { message.value = '模板没有变化，无需保存。'; return }
  let captured
  try { captured = submission.capture({ id: selected.value?.canEdit ? selected.value.id : undefined,
    version: selected.value?.canEdit ? selected.value.version : undefined, input: documentTemplateInputSchema.parse(model) }) }
  catch (cause) { message.value = draftError(cause); return }
  const original = JSON.stringify(model)
  busy.value = true; message.value = ''
  const operation = feedback.begin(`正在保存模板「${captured.input.input.name}」`)
  try {
    const { id, version, input } = captured.input
    const saved = await $fetch<DocumentTemplate>(id ? `/api/document-templates/${id}` : '/api/document-templates', {
      method: id ? 'PUT' : 'POST', body: id ? { ...input, version } : input,
      headers: { 'Idempotency-Key': captured.key }, retry: 0, timeout: 15_000,
    })
    submission.confirmed()
    recoverable.value = false
    operation.success(`模板「${input.name}」已保存`)
    if (!operation.isCurrent()) return
    selected.value = saved
    if (saved.name !== input.name || saved.description !== input.description || saved.documentType !== input.documentType
      || !sameVersionContent({ title: '', contentJson: saved.contentJson }, { title: '', contentJson: input.contentJson })) {
      saveConflict.value = true
      message.value = '本次保存已成功，但模板随后又被更新。当前输入已保留，请放弃修改以重新载入最新模板。'
      operation.warning(message.value)
      return
    }
    baseline.value = original
    message.value = '模板已保存，之后创建的文档可以使用最新内容。'
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (cause) { submission.failed(cause); recoverable.value = !!submission.recover(); message.value = draftError(cause); operation.error(`模板保存未完成：${message.value}，输入已保留。`) }
  finally { busy.value = false }
}
onBeforeRouteLeave(() => { if (busy.value || dirty.value || uploads.value.uploading) { message.value = '请先保存或放弃当前修改，再离开模板管理。'; return false } })
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <main class="workspace-page templates-page">
    <h1 class="visually-hidden">模板管理</h1>
    <div v-if="loadError" class="workspace-feedback" role="alert">模板加载失败。<BingButton variant="secondary" @click="refresh()">重试</BingButton></div>
    <BingCard class="templates-card" variant="plain" padding="none" rounded="md" :glass="false" :interactive="false" :tilt="false" :glare="false" entrance="none" flip-trigger="none">
    <div ref="layoutRoot" class="templates-workspace" :class="{ 'templates-workspace--compact': compact }">
      <div class="templates-toolbar">
        <BingInput v-model="search" :icon="Search" placeholder="搜索模板名称或用途" aria-label="搜索模板名称或用途" size="lg" clearable block />
        <BingSelect v-model="filterType" :options="[{ value: 'all', label: '全部类型' }, ...typeOptions]" :clearable="false" :searchable="false" :min-width="0" size="lg" block aria-label="筛选模板类型" />
        <BingSelect v-model="filterSource" :options="sourceOptions" :clearable="false" :searchable="false" :min-width="0" size="lg" block aria-label="筛选模板来源" />
        <BingButton variant="tertiary" size="lg" :disabled="busy" @click="load(null)"><span class="template-action-label"><BingIcon :icon="Plus" :size="16" decorative />新建模板</span></BingButton>
      </div>
      <BingTabs v-if="compact" v-model="activePane" :items="[{ value: 'directory', label: '模板目录' }, { value: 'preview', label: editing ? '正在编辑' : '模板预览' }]" class="templates-pane-tabs" variant="soft" aria-label="模板区域">
        <template #item="{ item, active }"><span :class="{ 'template-pane-active': active }">{{ item.label }}</span></template>
      </BingTabs>
    <div class="templates-layout" :class="{ 'templates-layout--compact': compact }">
      <aside v-show="!compact || activePane === 'directory'" class="templates-list" aria-label="项目模板">
        <div class="templates-library-heading">
          <h2>模板库 <span class="template-count">{{ filteredTemplates.length }}</span></h2>
          <span class="workspace-count">内置 {{ builtInCount }} · 项目 {{ filteredTemplates.length - builtInCount }}</span>
        </div>
        <BingScrollbar :max-height="compact ? undefined : 'calc(100dvh - 282px)'" aria-label="模板库列表">
          <p v-if="!filteredTemplates.length && !loadError" class="workspace-empty">{{ templates?.length ? '没有符合条件的模板' : '暂无模板，点击新建模板开始。' }}</p>
          <div class="templates-grid">
            <button v-for="item in filteredTemplates" :key="item.id" type="button" class="template-list-item" :class="{ active: selected?.id === item.id }" :aria-pressed="selected?.id === item.id" :aria-label="item.name" :disabled="busy" @click="load(item)">
              <div class="template-list-item__thumbnail" aria-label="正文结构">
                <div class="template-list-item__icons"><BingIcon :icon="typeIcons[item.documentType]" :size="16" decorative /><BingIcon v-if="selected?.id === item.id" :icon="CircleCheck" :size="16" decorative /></div>
                <div v-for="(section, i) in previews[item.id]?.sections" :key="i" class="template-list-item__section">
                  <strong>{{ section.heading }}</strong><span>{{ section.hint }}</span>
                </div>
                <span v-if="previews[item.id]?.remaining" class="template-list-item__remaining">还有 {{ previews[item.id]?.remaining }} 个章节</span>
                <p v-if="!previews[item.id]?.sections.length" class="template-list-item__summary">{{ previews[item.id]?.summary || '空白正文，可从这里开始。' }}</p>
              </div>
              <strong class="template-list-item__name">{{ item.name }}</strong>
              <p class="template-list-item__description">{{ item.description || previews[item.id]?.summary || '暂无用途说明' }}</p>
              <div class="template-list-item__meta"><span class="template-type-label">{{ DOCUMENT_TYPE_LABELS[item.documentType] }}</span><span>{{ item.builtIn ? '内置' : '项目' }} · {{ previews[item.id]?.total ?? 0 }} 个章节</span></div>
            </button>
          </div>
        </BingScrollbar>
      </aside>
      <section v-show="!compact || activePane === 'preview'" class="template-edit-panel" aria-label="模板内容">
        <div class="template-edit-actions">
          <h2><BingIcon :icon="editing ? Pencil : PanelLeft" :size="18" decorative />{{ editing ? (selected ? '编辑模板' : '新建模板') : '正文预览' }}</h2>
          <BingButton v-if="selected?.canEdit && !editing" @click="editSelected">编辑模板</BingButton>
          <BingButton v-if="selected" variant="tertiary" :disabled="busy" @click="load(selected, true)"><span class="template-action-label"><BingIcon :icon="Copy" :size="16" decorative />复制为新模板</span></BingButton>
          <BingButton v-if="editing && selected" variant="ghost" :disabled="busy" @click="previewSelected">预览模板</BingButton>
          <BingButton v-if="editing" variant="secondary" :disabled="busy" @click="discard">放弃修改</BingButton>
          <BingButton v-if="editing" :form="formId" html-type="submit" :loading="busy" :disabled="!canSave">保存模板</BingButton>
        </div>
        <p v-if="message" class="template-feedback" role="status">{{ message }}</p>
        <BingButton v-if="recoverable && !busy" variant="secondary" @click="recoverSubmission">恢复上次提交内容</BingButton>
        <div v-if="editing" class="template-edit-content">
          <BingForm :id="formId" :model="formModel" :schema="formSchema" layout="grid" :columns="compact ? { base: 1, sm: 3 } : 3" :gap="{ row: 8, column: 12 }" :disabled="busy" @submit="save">
            <BingFormItem prop="name" label="模板名称" :span="2" required><BingInput v-model="model.name" :maxlength="80" block /></BingFormItem>
            <BingFormItem prop="documentType" label="所属类型" required><BingSelect v-model="typeValue" :options="typeOptions" :clearable="false" :searchable="false" :min-width="0" block aria-label="所属类型" /></BingFormItem>
            <BingFormItem prop="description" label="用途说明" :span="3"><BingTextarea v-model="model.description" :max-length="500" :rows="2" block /></BingFormItem>
          </BingForm>
          <p class="template-editor-hint">编辑下方正文，设置章节、填写提示、表格和示例。</p>
          <ClientOnly>
            <RichRequirementEditor :key="editorKey" v-model="model.contentJson" :disabled="busy" :viewport-bottom-gap="compact ? undefined : 48" hide-outline @image-upload-state="uploads = $event" @error="message = $event" />
            <template #fallback><p role="status">正在加载模板编辑器…</p></template>
          </ClientOnly>
          <p v-if="uploads.uploading || uploads.failed" role="alert">请等待图片上传完成，或处理失败的图片后再保存模板。</p>
        </div>
        <div v-else-if="selected" class="template-preview-content">
          <header class="template-preview-heading">
            <div class="template-preview-meta">
              <span class="template-preview-type"><BingIcon :icon="typeIcons[selected.documentType]" :size="16" decorative />{{ DOCUMENT_TYPE_LABELS[selected.documentType] }}</span>
              <span class="template-type-label">{{ selected.builtIn ? '内置模板' : '项目模板' }}</span><span>v{{ selected.version }}</span><span v-if="!selected.canEdit">只读</span>
            </div>
            <h2>{{ selected.name }}</h2><p v-if="selected.description">{{ selected.description }}</p>
          </header>
          <RichTextRevisionViewer :document="selected.contentJson" label="模板正文预览" />
          <p v-if="selected.builtIn" class="template-preview-note"><BingIcon :icon="LockKeyhole" :size="16" decorative />内置模板保留原版，复制后可按团队需要定制。</p>
        </div>
        <p v-else class="workspace-empty">选择模板查看正文预览。</p>
      </section>
    </div>
    </div>
    </BingCard>
  </main>
</template>

<style scoped>
.templates-page { padding: 24px; background: var(--ui-navigation); }
.templates-card { --bing-radius-card: 12px; --bing-shadow-md: none; min-width: 0; }
.templates-workspace { min-width: 0; }
.templates-toolbar { display: grid; grid-template-columns: minmax(180px, 1fr) 132px 132px auto; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--bing-border); }
.templates-layout { display: grid; grid-template-columns: minmax(0, 43fr) minmax(0, 57fr); min-height: calc(100dvh - 204px); }
.templates-layout--compact { grid-template-columns: minmax(0, 1fr); }
.templates-pane-tabs { margin: 12px 16px; }
.template-pane-active { color: var(--ui-accent); }
.template-action-label { display: inline-flex; align-items: center; gap: 8px; }
.templates-list { padding: 20px; border-right: 1px solid var(--bing-border); min-width: 0; background: color-mix(in srgb, var(--bing-surface-solid) 55%, var(--ui-navigation)); border-bottom-left-radius: 12px; }
.templates-library-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; }
.templates-library-heading h2, .template-edit-actions h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; line-height: 24px; margin: 0; color: var(--bing-heading); }
.template-count, .template-type-label { display: inline-block; padding: 1px 6px; border-radius: 3px; background: var(--ui-navigation); color: var(--bing-muted); font-size: 12px; font-weight: 400; line-height: 18px; }
.templates-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 2px; }
.template-list-item { display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%; text-align: left; padding: 10px; border: 1px solid var(--bing-border); border-radius: 8px; background: var(--bing-surface-solid); color: inherit; font: inherit; cursor: pointer; }
.template-list-item__thumbnail { display: flex; flex-direction: column; gap: 8px; width: 100%; min-height: 202px; padding: 12px; border: 1px solid color-mix(in srgb, var(--bing-border) 55%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--bing-surface-solid) 55%, var(--ui-navigation)); font-size: 12px; line-height: 20px; }
.template-list-item__icons { display: flex; justify-content: space-between; align-items: center; height: 20px; color: var(--ui-accent); }
.template-list-item__section { display: grid; gap: 2px; min-width: 0; }
.template-list-item__section strong, .template-list-item__section span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.template-list-item__section strong { font-weight: 500; }
.template-list-item__section span, .template-list-item__remaining { color: var(--bing-muted); }
.template-list-item__name { margin-top: 2px; overflow-wrap: anywhere; color: var(--bing-heading); }
.template-list-item__description, .template-list-item__summary { margin: 0; font-size: 12px; line-height: 20px; color: var(--bing-muted); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.template-list-item__description { min-height: 40px; }
.template-list-item__meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 8px; margin-top: auto; font-size: 12px; color: var(--bing-muted); }
.template-list-item:hover, .template-list-item:focus-visible { border-color: var(--ui-accent); }
.template-list-item:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.template-list-item.active { border-color: var(--ui-accent); box-shadow: 0 0 0 1px var(--ui-accent); }
.template-list-item:disabled { cursor: wait; }
.template-edit-panel { min-width: 0; }
.template-edit-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 62px; padding: 12px 20px; border-bottom: 1px solid var(--bing-border); }
.template-edit-actions h2 { margin-right: auto; }
.template-edit-actions h2 .bing-icon { color: var(--ui-accent); }
.template-edit-content { padding: 16px 24px; }
.template-editor-hint { margin: 8px 0 12px; color: var(--bing-muted); font-size: 12px; line-height: 20px; }
.template-preview-content { padding: 24px 32px; }
.template-preview-heading { padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid var(--bing-border); }
.template-preview-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--bing-muted); font-size: 12px; }
.template-preview-type { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-accent); }
.template-preview-heading h2 { margin: 16px 0 12px; color: var(--bing-heading); font-size: 24px; line-height: 1.4; overflow-wrap: anywhere; }
.template-preview-heading p { margin: 0; color: var(--bing-muted); line-height: 1.8; overflow-wrap: anywhere; }
.template-preview-content :deep(.requirement-revision-viewer__surface) { min-height: 0; padding: 0; }
.template-preview-note { display: flex; align-items: flex-start; gap: 8px; margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--bing-border); color: var(--bing-muted); font-size: 12px; line-height: 20px; }
.template-preview-note .bing-icon { flex-shrink: 0; margin-top: 2px; }
.template-feedback { margin: 16px 20px; padding: 12px; border: 1px solid var(--bing-border); border-radius: 8px; }
.templates-layout--compact .templates-list { border-right: 0; }
.templates-layout--compact { min-height: 0; }
.templates-workspace--compact .templates-toolbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
.templates-workspace--compact .templates-toolbar > :first-child { grid-column: 1 / -1; }
@media (max-width: 600px) {
  .templates-page { padding: 16px 12px; }
  .templates-toolbar { padding: 12px; }
  .templates-workspace--compact .templates-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .templates-toolbar > :last-child { grid-column: 1 / -1; justify-self: end; }
  .templates-list { padding: 12px; }
  .templates-grid { grid-template-columns: minmax(0, 1fr); }
  .template-edit-actions { padding: 12px; }
  .template-edit-content, .template-preview-content { padding: 16px; }
}
</style>
