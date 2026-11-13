<script setup lang="ts">
import { reactive, ref, useId, watch } from 'vue'
import { z } from 'zod'
import { BingButton, BingDialog, BingForm, BingFormItem, BingInput, BingTextarea, type BingFormSubmitPayload } from '@moubing/bing-ui'
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '#shared/documents/workflow'
import { instantiateTemplate } from '#shared/documents/templates'
import type { RichTextDocument } from '#shared/editor/document'
import { draftError } from '#shared/drafts/document'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
import { createRetryableSubmission } from '../../utils/retryable-submission'
const props = defineProps<{ title: string; documentType: DocumentType; content: RichTextDocument }>()
const open = defineModel<boolean>({ default: false })
const formId = useId()
const feedback = useOperationFeedback()
const submission = createRetryableSubmission<{ name: string; description: string; documentType: DocumentType; contentJson: RichTextDocument }>()
const model = reactive({ name: '', description: '' })
const schema = z.object({ name: z.string().trim().min(1, '请输入模板名称').max(80), description: z.string().max(500) })
const busy = ref(false), error = ref('')
const recoverable = ref(false)
function recoverSubmission() {
  const input = submission.recover()
  if (input) { Object.assign(model, { name: input.name, description: input.description }); snapshot = input.contentJson; error.value = '已恢复上次提交的输入，请重试确认保存结果。' }
}
let snapshot: RichTextDocument | null = null
watch(open, value => { if (value && !error.value && !busy.value) { Object.assign(model, { name: `${props.title}模板`.slice(0, 80), description: '' }); snapshot = instantiateTemplate(props.content) } })
async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value || !snapshot) return
  let captured
  try { captured = submission.capture({ ...schema.parse(model), documentType: props.documentType, contentJson: snapshot }) }
  catch (cause) { error.value = draftError(cause); return }
  busy.value = true; error.value = ''
  open.value = false
  const operation = feedback.begin(`正在保存模板「${captured.input.name}」`)
  try {
    await $fetch('/api/document-templates', { method: 'POST', body: captured.input, headers: { 'Idempotency-Key': captured.key }, retry: 0, timeout: 15_000 })
    submission.confirmed()
    recoverable.value = false
    operation.success(`模板「${captured.input.name}」已保存，可在模板管理中查看。`)
  }
  catch (cause) { submission.failed(cause); recoverable.value = !!submission.recover(); error.value = draftError(cause); operation.error(`模板保存未完成：${error.value}，重新打开可继续处理。`) }
  finally { busy.value = false }
}
</script>
<template>
  <BingDialog :busy="busy" v-model="open" title="另存为模板" :width="520" :show-peek="false">
    <BingForm :id="formId" :model="model" :schema="schema" :disabled="busy" layout="stack" @submit="submit">
      <p>将当前正文保存为「{{ DOCUMENT_TYPE_LABELS[documentType] }}」模板。模板在项目内共享。</p>
      <BingFormItem prop="name" label="模板名称" required><BingInput v-model="model.name" :maxlength="80" block autofocus /></BingFormItem>
      <BingFormItem prop="description" label="用途说明"><BingTextarea v-model="model.description" :max-length="500" :rows="3" block /></BingFormItem>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      <BingButton v-if="recoverable && !busy" variant="secondary" @click="recoverSubmission">恢复上次提交内容</BingButton>
    </BingForm>
    <template #footer>
      <BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton>
      <BingButton html-type="submit" :form="formId" :loading="busy">保存模板</BingButton>
    </template>
  </BingDialog>
</template>
