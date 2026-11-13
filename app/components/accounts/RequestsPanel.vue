<script setup lang="ts">
import { BingButton, BingCheckboxGroup, BingDialog, BingForm, BingFormItem, BingRadioGroup, BingTable, BingTextarea } from '@moubing/bing-ui'
import type { BingCheckboxGroupValue, BingFormExpose, BingFormSubmitPayload, BingRadioValue, BingTableColumn, BingTableRow } from '@moubing/bing-ui'
import { PROJECT_ROLES, PROJECT_ROLE_LABELS } from '#shared/auth/access'
import type { ManagedRequest, PageResult } from '#shared/auth/access'
import { reviewSchema } from '#shared/auth/account-input'
import { accountDate, accountError } from '~/utils/account-display'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
const feedback = useOperationFeedback()
const page = ref(1)
const pageSize = ref(20)
const requestFetch = useRequestFetch()
const { data, pending, error: loadError, refresh } = await useAsyncData('access-requests', () =>
  requestFetch<PageResult<ManagedRequest>>('/api/admin/requests', { query: { page: page.value, limit: pageSize.value } }), { watch: [page, pageSize] })
const rows = computed(() => (data.value?.items ?? []).map((row) => ({ ...row })))
const columns: BingTableColumn[] = [
  { key: 'identity', title: '申请人', minWidth: 220 }, { key: 'message', title: '加入说明', minWidth: 230 },
  { key: 'status', title: '审批状态', width: 130 }, { key: 'createdAt', title: '申请时间', width: 180 },
  { key: 'actions', title: '操作', width: 90 },
]
const labels = { pending: '待审批', approved: '已批准', rejected: '已拒绝' }
const selected = ref<ManagedRequest | null>(null)
const open = ref(false)
const reviewForm = ref<BingFormExpose | null>(null)
const formId = useId()
const form = reactive({ decision: 'approve' as BingRadioValue, roles: [] as BingCheckboxGroupValue[], note: '' })
const decisionOptions = [{ label: '批准加入', value: 'approve' }, { label: '拒绝申请', value: 'reject' }]
const roleOptions = PROJECT_ROLES.map((role) => ({ label: PROJECT_ROLE_LABELS[role], value: role }))
const busy = ref(false)
const error = ref('')
const notice = ref('')
const failedReview = ref<{ target: ManagedRequest; input: ReturnType<typeof reviewSchema.parse>; error: string } | null>(null)
watch(() => form.decision, () => {
  reviewForm.value?.clearValidate()
  error.value = ''
})
function review(row: BingTableRow) {
  selected.value = row as unknown as ManagedRequest
  const previous = failedReview.value?.target.id === selected.value.id ? failedReview.value : null
  form.roles = [...(previous?.input.roles ?? [])]
  form.note = previous?.input.note ?? ''
  form.decision = previous?.input.decision ?? 'approve'
  error.value = previous?.error ?? ''
  open.value = true
}
async function submit({ valid }: BingFormSubmitPayload) {
  // BingForm 校验失败也会触发 submit；必须检查 valid 才能调用接口。
  if (!valid || !selected.value || busy.value) return
  const target = selected.value
  const input = reviewSchema.parse(form)
  error.value = ''
  busy.value = true
  open.value = false
  const operation = feedback.begin(`正在${input.decision === 'approve' ? '批准' : '拒绝'} ${target.user.name} 的加入申请`)
  try {
    await $fetch(`/api/admin/requests/${target.id}/review`, { method: 'POST', body: input, retry: 0, timeout: 15_000 })
    operation.success(`${target.user.name} 的加入申请已${input.decision === 'approve' ? '批准' : '拒绝'}`)
    if (!operation.isCurrent()) return
    failedReview.value = null
    notice.value = input.decision === 'approve' ? '已批准加入，项目角色已分配' : '已拒绝申请，申请人可以查看原因并重新申请'
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error(`${target.user.name} 的申请处理失败：${message}，审批输入已保留。`)
    if (operation.isCurrent()) { failedReview.value = { target, input, error: message }; if (selected.value?.id === target.id) error.value = message }
  }
  finally { busy.value = false }
}
</script>

<template>
  <div class="account-toolbar"><p class="account-hint">待审批申请优先显示。审批通过后，成员才能访问文档。</p><BingButton variant="secondary" :loading="pending" @click="refresh()">刷新</BingButton></div>
  <p v-if="loadError" class="account-error" role="alert">{{ accountError(loadError) }}</p>
  <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
  <p v-if="failedReview" class="account-error" role="alert">{{ failedReview.target.user.name }}：{{ failedReview.error }}<BingButton size="sm" variant="ghost" @click="review(failedReview.target as unknown as BingTableRow)">继续处理申请</BingButton></p>
  <div class="account-table-card">
    <BingTable
      v-model:page="page" v-model:page-size="pageSize"
      :data="rows" :columns="columns" :loading="pending"
      pagination remote-pagination :total="data?.total ?? 0"
      empty-text="暂无加入申请" aria-label="加入申请"
    >
      <template #cell-identity="{ row }"><div class="account-cell-identity"><strong>{{ (row.user as ManagedRequest['user']).name }}</strong><small>{{ (row.user as ManagedRequest['user']).email }}</small></div></template>
      <template #cell-message="{ row }"><span :title="String(row.message || row.reviewNote || '')">{{ row.message || row.reviewNote || '未填写' }}</span></template>
      <template #cell-status="{ row }"><span class="account-badge" :class="{ 'account-badge--green': row.status === 'approved', 'account-badge--red': row.status === 'rejected' }">{{ labels[row.status as keyof typeof labels] }}</span></template>
      <template #cell-createdAt="{ row }"><span class="account-hint">{{ accountDate(String(row.createdAt)) }}</span></template>
      <template #cell-actions="{ row }"><BingButton size="sm" variant="ghost" @click="review(row)">{{ row.status === 'pending' ? '审批' : '查看' }}</BingButton></template>
    </BingTable>
  </div>
  <BingDialog :busy="busy" v-model="open" title="处理加入申请" :width="550" :close-on-overlay="false">
    <div v-if="selected" class="account-stack">
      <div class="account-notice"><strong>{{ selected.user.name }} · {{ selected.user.email }}</strong><p>{{ selected.message || '未填写加入说明' }}</p></div>
      <BingForm v-if="open && selected.status === 'pending'" :id="formId" ref="reviewForm"
        :model="form" :schema="reviewSchema" layout="stack" :gap="18" :disabled="busy" @submit="submit">
        <BingFormItem prop="decision" label="审批结果">
          <BingRadioGroup v-model="form.decision" :options="decisionOptions" aria-label="审批结果" />
        </BingFormItem>
        <BingFormItem v-if="form.decision === 'approve'" prop="roles" label="项目角色（可多选）" required help="至少选择一个项目角色，可以同时担任多个角色。">
          <BingCheckboxGroup v-model="form.roles" :options="roleOptions" aria-label="项目角色" />
        </BingFormItem>
        <BingFormItem prop="note" :label="form.decision === 'reject' ? '拒绝原因' : '审批说明（选填）'" :required="form.decision === 'reject'">
          <BingTextarea v-model="form.note" :rows="3" :max-length="1000" :aria-label="form.decision === 'reject' ? '拒绝原因' : '审批说明'" />
        </BingFormItem>
        <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      </BingForm>
      <template v-else-if="selected.status !== 'pending'"><p>{{ labels[selected.status] }} · {{ selected.reviewedAt ? accountDate(selected.reviewedAt) : '' }}</p><p>审批说明：{{ selected.reviewNote || '未填写' }}</p></template>
    </div>
    <template #footer>
      <BingButton variant="secondary" :disabled="busy" @click="open = false">{{ selected?.status === 'pending' ? '取消' : '关闭' }}</BingButton>
      <BingButton v-if="selected?.status === 'pending'" html-type="submit" :form="formId" :loading="busy">{{ form.decision === 'approve' ? '确认批准' : '确认拒绝' }}</BingButton>
    </template>
  </BingDialog>
</template>
