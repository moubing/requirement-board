<script setup lang="ts">
import { useRequirementCache } from '~/composables/use-requirement-cache'
import { BingButton, BingDialog, BingForm, BingFormItem, BingInput, BingSelect, BingScrollbar } from '@moubing/bing-ui'
import type { BingFormExpose, BingFormSubmitPayload, BingSelectModelValue } from '@moubing/bing-ui'
import { createRequirementSchema } from '#shared/requirements/input'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, type DocumentType } from '#shared/documents/workflow'
import type { DocumentTemplate } from '#shared/documents/templates'
import { draftError } from '#shared/drafts/document'
import type { BoardMeta } from '~/types/requirement-board'
import DocumentAssignees from '../documents/DocumentAssignees.vue'
import RichTextRevisionViewer from '../revision/RichTextRevisionViewer.vue'
import { useRoute } from '#app'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
import { createRetryableSubmission } from '../../utils/retryable-submission'

defineProps<{ meta: BoardMeta }>()
const index = useRequirementCache()
const route = useRoute()
const feedback = useOperationFeedback()
const submission = createRetryableSubmission<ReturnType<typeof createRequirementSchema.parse>>()
const createdLink = ref<{ id: string; title: string } | null>(null)
// 创建结果只在尚未到达目标文档时保留；手动打开结果链接也会消费该入口。
watch([() => route.path, createdLink], ([path, created]) => {
  if (created && path === `/requirements/${created.id}`) createdLink.value = null
})
let navigationSequence = 0
let formSequence = 0
watch(() => route.fullPath, () => { navigationSequence++ })
const open = defineModel<boolean>({ default: false })
const formId = useId()
const formRef = ref<BingFormExpose | null>(null)
const form = reactive({ title: '', priority: 'medium', documentType: 'requirement' as DocumentType, templateId: null as string | null, assigneeIds: [] as string[] })
const templates = ref<DocumentTemplate[]>([])
const busy = ref(false), loading = ref(false), error = ref('')
const templateError = ref(''), recoverable = ref(false)
function recoverSubmission() {
  const input = submission.recover()
  if (input) { Object.assign(form, input); error.value = '已恢复上次提交的输入，请重试确认创建结果。' }
}
const priorityOptions = [{ value: 'low', label: '低优先级' }, { value: 'medium', label: '中优先级' }, { value: 'high', label: '高优先级' }]
const typeOptions = DOCUMENT_TYPES.map(value => ({ value, label: DOCUMENT_TYPE_LABELS[value] }))
const typeValue = computed<BingSelectModelValue>({ get: () => form.documentType, set: value => { if (DOCUMENT_TYPES.includes(value as DocumentType)) { form.documentType = value as DocumentType; form.templateId = null; form.assigneeIds = [] } } })
const templateValue = computed<BingSelectModelValue>({ get: () => form.templateId ?? '', set: value => { if (typeof value === 'string') form.templateId = value || null } })
const priorityValue = computed<BingSelectModelValue>({ get: () => form.priority, set: value => { if (typeof value === 'string') form.priority = value } })
const templateOptions = computed(() => [
  { value: '', label: '空白模板', description: '从空白正文开始编写' },
  ...templates.value.filter(item => item.documentType === form.documentType).map(item => ({ value: item.id, label: item.name, description: item.description })),
])
const selectedTemplate = computed(() => templates.value.find(item => item.id === form.templateId))
const templateReady = computed(() => form.templateId === null || (!loading.value && !!selectedTemplate.value))
async function loadTemplates() {
  loading.value = true; templateError.value = ''
  try { templates.value = await $fetch<DocumentTemplate[]>('/api/document-templates') }
  catch (cause) { templates.value = []; templateError.value = draftError(cause) }
  finally { loading.value = false }
}
watch(open, value => { if (value) { formSequence++; formRef.value?.clearValidate(); void loadTemplates() } })
async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value || !templateReady.value) return
  let captured
  try { captured = submission.capture(createRequirementSchema.parse(form)) }
  catch (cause) { error.value = draftError(cause); return }
  const formAtStart = formSequence
  const navigationAtStart = navigationSequence
  const original = JSON.stringify(form)
  busy.value = true; error.value = ''
  open.value = false
  const operation = feedback.begin(`正在创建文档「${captured.input.title}」`)
  try {
    const created = await $fetch<{ id: string }>('/api/requirements', { method: 'POST', body: captured.input,
      headers: { 'Idempotency-Key': captured.key }, retry: 0, timeout: 15_000 })
    submission.confirmed()
    recoverable.value = false
    operation.success(`文档「${captured.input.title}」已创建`)
    if (!operation.isCurrent()) return
    index.invalidate()
    createdLink.value = { id: created.id, title: captured.input.title }
    if (formSequence === formAtStart && JSON.stringify(form) === original) Object.assign(form, { title: '', priority: 'medium', templateId: null, assigneeIds: [] })
    if (formSequence === formAtStart && navigationSequence === navigationAtStart) {
      try { await navigateTo('/requirements/' + created.id) }
      catch { operation.warning('文档已创建，暂时无法跳转，请使用创建结果中的链接打开。') }
    }
  } catch (cause) {
    submission.failed(cause)
    recoverable.value = !!submission.recover()
    operation.error(`文档「${captured.input.title}」创建未完成：${draftError(cause)}，输入已保留。`)
    if (operation.isCurrent()) error.value = draftError(cause)
  }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="!open && (error || createdLink)" class="document-create-result" role="status">
    <template v-if="error"><span>文档创建未完成，输入已保留。</span><BingButton size="sm" variant="ghost" @click="open = true">继续创建</BingButton></template>
    <NuxtLink v-else-if="createdLink" :to="`/requirements/${createdLink.id}`">已创建：{{ createdLink.title }}</NuxtLink>
    <BingButton size="sm" variant="ghost" aria-label="关闭创建结果提示" @click="error = ''; createdLink = null">关闭</BingButton>
  </div>
  <BingDialog :busy="busy" v-model="open" title="新建文档" :width="720" :show-peek="false">
    <div class="document-create-layout">
      <BingForm :id="formId" ref="formRef" :model="form" :schema="createRequirementSchema" layout="stack" :disabled="busy" @submit="submit">
        <BingFormItem prop="documentType" label="文档类型" required><BingSelect v-model="typeValue" :options="typeOptions" :clearable="false" :searchable="false" block aria-label="文档类型" /></BingFormItem>
        <BingFormItem prop="templateId" label="正文模板"><BingSelect v-model="templateValue" :options="templateOptions" :clearable="false" block aria-label="正文模板" /></BingFormItem>
        <BingFormItem prop="title" label="文档标题" required><BingInput v-model="form.title" placeholder="输入文档标题" :maxlength="240" block autofocus /></BingFormItem>
        <BingFormItem prop="assigneeIds" label="负责人"><DocumentAssignees v-model="form.assigneeIds" :users="meta.users" :disabled="busy" /></BingFormItem>
        <BingFormItem prop="priority" label="优先级"><BingSelect v-model="priorityValue" :options="priorityOptions" :clearable="false" :searchable="false" block aria-label="优先级" /></BingFormItem>
        <p>新文档从「草稿」开始，创建后继续编写正文。</p>
      </BingForm>
      <section class="document-template-preview" aria-label="模板预览">
        <h3>{{ form.templateId === null ? '空白模板' : selectedTemplate?.name ?? '模板预览' }}</h3>
        <p v-if="selectedTemplate?.description">{{ selectedTemplate.description }}</p>
        <div v-if="form.templateId === null" class="document-template-preview__empty"><strong>从空白正文开始</strong><p>创建后自由编写内容，也可以选择模板带入正文结构。</p></div>
        <p v-else-if="loading" role="status">正在加载模板…</p>
        <BingScrollbar v-else-if="selectedTemplate" max-height="min(58dvh, 560px)"><RichTextRevisionViewer :document="selectedTemplate.contentJson" label="模板正文预览" /></BingScrollbar>
      </section>
    </div>
    <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    <BingButton v-if="recoverable && !busy" variant="secondary" @click="recoverSubmission">恢复上次提交内容</BingButton>
    <p v-if="templateError" class="account-error" role="alert">{{ templateError }}</p>
    <BingButton v-if="templateError" variant="secondary" @click="loadTemplates">重新加载模板</BingButton>
    <template #footer>
      <BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton>
      <BingButton html-type="submit" :form="formId" :disabled="!templateReady" :loading="busy">创建并编辑</BingButton>
    </template>
  </BingDialog>
</template>

<style scoped>
.document-create-result { position: fixed; z-index: 100; right: 20px; bottom: 20px; max-width: calc(100vw - 40px); display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px; border: 1px solid var(--bing-border); border-radius: 8px; background: var(--bing-surface-solid); font-size: 13px; }
.document-create-result a { color: var(--bing-accent-strong); overflow-wrap: anywhere; }
.document-create-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; }
.document-template-preview { min-width: 0; }
.document-template-preview h3 { margin: 0 0 8px; }
.document-template-preview p { color: var(--bing-muted); }
.document-template-preview__empty { min-height: 320px; display: flex; flex-direction: column; justify-content: center; padding: 24px; border: 1px dashed var(--bing-border); border-radius: 8px; }
.document-template-preview__empty p { margin-bottom: 0; }
.document-template-preview :deep(.requirement-revision-viewer__surface) { min-height: 0; padding: 12px; }
@media (max-width: 680px) { .document-create-layout { grid-template-columns: minmax(0, 1fr); } .document-template-preview__empty { min-height: 160px; } }
</style>
