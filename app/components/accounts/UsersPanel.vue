<script setup lang="ts">
import { BingButton, BingDialog, BingForm, BingFormItem, BingInput, BingSelect, BingTable, BingTextarea } from '@moubing/bing-ui'
import type { BingFormSubmitPayload, BingTableColumn, BingTableRow } from '@moubing/bing-ui'
import { accountStatusSchema, userUpdateSchema } from '#shared/auth/account-input'
import { PROJECT_ROLES, PROJECT_ROLE_LABELS } from '#shared/auth/access'
import type { AccountAudit, ManagedUser, PageResult, ProjectRole } from '#shared/auth/access'
import { accountDate, accountError, userStatus } from '~/utils/account-display'
import { accountAuditLabel, accountAuditSummary } from '~/utils/account-audit'
import RolePicker from './RolePicker.vue'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
const feedback = useOperationFeedback()

const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ search: '', role: '', status: '' })
const applied = reactive({ ...filters })
const requestFetch = useRequestFetch()
const { data, pending, error: loadError, refresh } = await useAsyncData('managed-users', () =>
  requestFetch<PageResult<ManagedUser>>('/api/admin/users', { query: { ...applied, page: page.value, limit: pageSize.value } }), { watch: [page, pageSize] })
const rows = computed(() => (data.value?.items ?? []).map((user) => ({ ...user })))
const columns: BingTableColumn[] = [
  { key: 'identity', title: '成员', minWidth: 220 }, { key: 'systemRole', title: '系统身份', width: 130 },
  { key: 'roles', title: '项目角色', minWidth: 230 }, { key: 'status', title: '账号状态', width: 120 },
  { key: 'actions', title: '操作', width: 90 },
]
const roleOptions = [{ value: '', label: '全部角色' }, ...PROJECT_ROLES.map((role) => ({ value: role, label: PROJECT_ROLE_LABELS[role] }))]
const statusOptions = [
  { value: '', label: '全部状态' }, { value: 'active', label: '已启用' }, { value: 'disabled', label: '已停用' },
  { value: 'pending', label: '待审批' }, { value: 'rejected', label: '申请被拒绝' }, { value: 'unjoined', label: '未加入' },
]
const systemOptions = [{ value: 'user', label: '普通用户' }, { value: 'admin', label: '超级管理员' }]
const selected = ref<ManagedUser | null>(null)
const events = ref<AccountAudit[]>([])
const open = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const dialogError = ref('')
const form = reactive({ name: '', systemRole: 'user', projectRoles: [] as ProjectRole[] })
const action = ref<'' | 'disable' | 'enable' | 'sessions'>('')
const reason = ref('')
const formId = useId()
const actionFormId = useId()
const actionForm = computed(() => ({ disabled: action.value === 'disable', reason: reason.value }))
const access = useAccountAccessState()
const recovery = ref<{ target: ManagedUser; form: typeof form; action: typeof action.value; reason: string; error: string } | null>(null)
function restore() {
  if (!recovery.value) return
  selected.value = recovery.value.target; Object.assign(form, recovery.value.form)
  action.value = recovery.value.action; reason.value = recovery.value.reason; dialogError.value = recovery.value.error; open.value = true
}

function applyFilters() {
  Object.assign(applied, filters)
  if (page.value === 1) void refresh()
  else page.value = 1
}
async function edit(row: BingTableRow) {
  if (recovery.value?.target.id === row.id) { restore(); return }
  error.value = ''
  try {
    const detail = await $fetch<{ user: ManagedUser; audit: AccountAudit[] }>(`/api/admin/users/${row.id}`)
    selected.value = detail.user
    events.value = detail.audit
    Object.assign(form, { name: detail.user.name, systemRole: detail.user.role, projectRoles: [...detail.user.projectRoles] })
    action.value = ''
    reason.value = ''
    dialogError.value = ''
    open.value = true
  } catch (err) { error.value = accountError(err) }
}
async function save({ valid }: BingFormSubmitPayload) {
  if (!valid || !selected.value || busy.value) return
  const target = selected.value
  const input = userUpdateSchema.parse(form)
  if (input.name === target.name && (!target.isMember || (input.systemRole === target.role
    && JSON.stringify([...(input.projectRoles ?? [])].sort()) === JSON.stringify([...target.projectRoles].sort())))) {
    dialogError.value = '用户资料和角色没有变化，无需保存。'; return
  }
  const capturedForm = { ...form, projectRoles: [...form.projectRoles] }
  const changedOwnRole = target.id === access.value?.user.id && input.systemRole !== target.role
  busy.value = true
  dialogError.value = ''
  open.value = false
  const operation = feedback.begin(`正在保存 ${target.name} 的用户资料和角色`)
  try {
    await $fetch(`/api/admin/users/${target.id}`, {
      method: 'PATCH', body: target.isMember ? input : { name: input.name }, retry: 0, timeout: 15_000,
    })
    operation.success(`${target.name} 的用户资料和角色已保存`)
    if (!operation.isCurrent()) return
    recovery.value = null
    if (changedOwnRole) { try { await navigateTo('/login') } catch { operation.warning('角色已保存，请刷新页面后重新登录。') }; return }
    notice.value = '用户资料和角色已保存'
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error(`${target.name} 的资料保存失败：${message}，输入已保留。`)
    if (operation.isCurrent()) recovery.value = { target, form: capturedForm, action: '', reason: '', error: message }
  }
  finally { busy.value = false }
}
async function performAction({ valid }: BingFormSubmitPayload) {
  if (!valid || !selected.value || busy.value || !action.value) return
  const target = selected.value
  const chosenAction = action.value
  const input = accountStatusSchema.parse(actionForm.value)
  const capturedForm = { ...form, projectRoles: [...form.projectRoles] }
  const capturedReason = reason.value
  const ownAccount = target.id === access.value?.user.id
  const label = chosenAction === 'sessions' ? '撤销登录会话' : chosenAction === 'disable' ? '停用账号' : '恢复账号'
  busy.value = true
  dialogError.value = ''
  open.value = false
  const operation = feedback.begin(`正在为 ${target.name} ${label}`)
  try {
    if (chosenAction === 'sessions') {
      await $fetch(`/api/admin/users/${target.id}/revoke-sessions`, { method: 'POST', body: {}, retry: 0, timeout: 15_000 })
    } else {
      await $fetch(`/api/admin/users/${target.id}/status`, { method: 'POST', body: input, retry: 0, timeout: 15_000 })
    }
    operation.success(`${target.name}：${label}已完成`)
    if (!operation.isCurrent()) return
    recovery.value = null
    if (ownAccount) { try { await navigateTo('/login') } catch { operation.warning('账号操作已完成，请刷新页面后重新登录。') }; return }
    notice.value = chosenAction === 'sessions' ? '该用户的登录会话已全部撤销' : chosenAction === 'disable' ? '账号已停用，登录会话已撤销' : '账号已恢复，可重新登录'
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error(`${target.name}：${label}失败，${message}`)
    if (operation.isCurrent()) recovery.value = { target, form: capturedForm, action: chosenAction, reason: capturedReason, error: message }
  }
  finally { busy.value = false }
}
</script>

<template>
  <form class="account-toolbar" @submit.prevent="applyFilters">
    <BingInput v-model="filters.search" placeholder="搜索姓名、用户名或邮箱" aria-label="搜索用户" clearable />
    <BingSelect :model-value="filters.role" :options="roleOptions" aria-label="按项目角色筛选" :width="160" @update:model-value="filters.role = String($event ?? '')" />
    <BingSelect :model-value="filters.status" :options="statusOptions" aria-label="按账号状态筛选" :width="150" @update:model-value="filters.status = String($event ?? '')" />
    <BingButton html-type="submit" variant="secondary" :loading="pending">查询</BingButton>
  </form>
  <p v-if="error || loadError" class="account-error" role="alert">{{ error || accountError(loadError) }}</p>
  <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
  <p v-if="recovery" class="account-error" role="alert">{{ recovery.target.name }}：{{ recovery.error }}<BingButton size="sm" variant="ghost" @click="restore">继续处理用户</BingButton></p>
  <div class="account-table-card">
    <BingTable
      v-model:page="page" v-model:page-size="pageSize"
      :data="rows" :columns="columns" :loading="pending"
      pagination remote-pagination :total="data?.total ?? 0"
      empty-text="没有符合条件的用户" aria-label="团队账号"
    >
      <template #cell-identity="{ row }"><div class="account-cell-identity"><strong>{{ row.name }}</strong><small>{{ row.email }}</small><small v-if="row.username">@{{ row.username }}</small></div></template>
      <template #cell-systemRole="{ row }"><span :class="{ 'account-badge': row.role === 'admin' }">{{ row.role === 'admin' ? '超级管理员' : '普通用户' }}</span></template>
      <template #cell-roles="{ row }"><div class="account-cell-roles"><span v-for="role in (row.projectRoles as ProjectRole[])" :key="role" class="account-badge">{{ PROJECT_ROLE_LABELS[role] }}</span><span v-if="!(row.projectRoles as ProjectRole[]).length" class="account-hint">{{ row.isMember ? '普通成员' : '—' }}</span></div></template>
      <template #cell-status="{ row }"><span class="account-badge" :class="{ 'account-badge--red': row.banned, 'account-badge--green': !row.banned && (row.isMember || row.role === 'admin') }">{{ userStatus(row as unknown as ManagedUser) }}</span></template>
      <template #cell-actions="{ row }"><BingButton size="sm" variant="ghost" @click="edit(row)">管理</BingButton></template>
    </BingTable>
  </div>

  <BingDialog :busy="busy" v-model="open" title="管理用户" :width="610" :close-on-overlay="false">
    <template v-if="selected">
      <BingForm v-if="!action" :id="formId" :model="form" :schema="userUpdateSchema" layout="stack" :disabled="busy" @submit="save">
        <div class="account-notice"><strong>{{ selected.email }}</strong><p class="account-hint">{{ userStatus(selected) }} · 注册于 {{ accountDate(selected.createdAt) }}</p><p v-if="selected.banReason">停用原因：{{ selected.banReason }}</p></div>
        <BingFormItem prop="name" label="姓名" required><BingInput v-model="form.name" maxlength="80" block /></BingFormItem>
        <template v-if="selected.isMember">
          <BingFormItem prop="systemRole" label="系统身份"><BingSelect :model-value="form.systemRole" :options="systemOptions" block :clearable="false" @update:model-value="form.systemRole = String($event)" /></BingFormItem>
          <p class="account-hint">超级管理员可以管理所有账号和项目权限。调整系统身份后，该用户需要重新登录。</p>
          <RolePicker v-model="form.projectRoles" :disabled="busy" />
        </template>
        <p v-else class="account-hint">该用户尚未加入项目，请先在「加入申请」中审批。</p>
        <p v-if="dialogError" class="account-error" role="alert">{{ dialogError }}</p>
        <div class="account-actions account-sensitive-actions">
          <BingButton variant="ghost" :disabled="busy" @click="action = selected.banned ? 'enable' : 'disable'; dialogError = ''">{{ selected.banned ? '恢复账号' : '停用账号' }}</BingButton>
          <BingButton variant="ghost" :disabled="busy" @click="action = 'sessions'; dialogError = ''">强制退出登录</BingButton>
        </div>
      </BingForm>
      <BingForm v-else :id="actionFormId" :model="actionForm" :schema="accountStatusSchema" layout="stack" :disabled="busy" @submit="performAction">
        <h3>{{ action === 'disable' ? '停用账号' : action === 'enable' ? '恢复账号' : '强制退出登录' }}</h3>
        <p>操作对象：{{ selected.name }}（{{ selected.email }}）</p>
        <p class="account-hint">{{ action === 'disable' ? '该用户将无法登录或访问项目，历史文档和操作记录会保留。' : action === 'enable' ? '恢复后，该用户可以重新登录，原有项目角色会保留。' : '该用户的所有登录会话都会失效，需要重新输入密码登录。' }}</p>
        <BingFormItem v-if="action === 'disable'" prop="reason" label="停用原因" required><BingTextarea v-model="reason" :max-length="500" :rows="3" /></BingFormItem>
        <p v-if="dialogError" class="account-error" role="alert">{{ dialogError }}</p>
      </BingForm>
      <details v-if="!action" class="account-audit">
        <summary>最近操作 · {{ events.length }} 条</summary><p v-if="!events.length" class="account-hint">暂无账号管理记录</p>
        <article v-for="event in events" :key="event.id" class="account-audit-item">
          <strong>{{ accountAuditLabel(event) }}</strong>
          <div class="account-hint">{{ event.actorName }} · {{ accountDate(event.createdAt) }}</div>
          <p v-if="accountAuditSummary(event)">{{ accountAuditSummary(event) }}</p>
        </article>
      </details>
    </template>
    <template #footer>
      <template v-if="!action"><BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton><BingButton html-type="submit" :form="formId" :loading="busy">保存修改</BingButton></template>
      <template v-else><BingButton variant="secondary" :disabled="busy" @click="action = ''; dialogError = ''">返回</BingButton><BingButton html-type="submit" :form="actionFormId" :loading="busy">确认操作</BingButton></template>
    </template>
  </BingDialog>
</template>
