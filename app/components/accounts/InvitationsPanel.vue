<script setup lang="ts">
import { BingButton, BingCheckboxGroup, BingDialog, BingForm, BingFormItem, BingInput, BingSelect, BingTable, BingTabs, BingTextarea } from '@moubing/bing-ui'
import type { BingCheckboxGroupValue, BingFormExpose, BingFormSubmitPayload, BingSelectModelValue, BingTableColumn, BingTableRow, BingTabValue } from '@moubing/bing-ui'
import type { AccountUser, Invitation, PageResult, ProjectRole } from '#shared/auth/access'
import { PROJECT_ROLES, PROJECT_ROLE_LABELS } from '#shared/auth/access'
import { invitationInputSchema, managedUserCreateSchema } from '#shared/auth/account-input'
import { accountDate, accountError, roleText } from '~/utils/account-display'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
const feedback = useOperationFeedback()
const props = defineProps<{ openRequest: boolean }>()
const emit = defineEmits<{ opened: []; userCreated: [] }>()
const page = ref(1)
const pageSize = ref(20)
const requestFetch = useRequestFetch()
const { data, pending, error: loadError, refresh } = await useAsyncData('invitations', () =>
  requestFetch<PageResult<Invitation>>('/api/admin/invitations', { query: { page: page.value, limit: pageSize.value } }), { watch: [page, pageSize] })
const rows = computed(() => (data.value?.items ?? []).map((row) => ({ ...row })))
const columns: BingTableColumn[] = [
  { key: 'identity', title: '受邀成员', minWidth: 220 }, { key: 'roles', title: '项目角色', minWidth: 200 },
  { key: 'status', title: '状态', width: 110 }, { key: 'expiresAt', title: '有效期至', width: 180 }, { key: 'actions', title: '操作', minWidth: 300 },
]
const labels = { pending: '等待接受', accepted: '已接受', revoked: '已撤销', expired: '已过期' }
const open = ref(false)
const revoking = ref<Invitation | null>(null)
const revokeOpen = ref(false)
const form = reactive({ name: '', email: '', username: '', password: '', systemRole: 'user' as BingSelectModelValue, roles: [] as BingCheckboxGroupValue[] })
const mode = ref<BingTabValue>('direct')
const modes = [{ value: 'direct', label: '直接创建' }, { value: 'invite', label: '邀请加入' }]
const roleOptions = PROJECT_ROLES.map((role) => ({ label: PROJECT_ROLE_LABELS[role], value: role }))
const systemOptions = [{ value: 'user', label: '普通用户' }, { value: 'admin', label: '超级管理员' }]
const activeForm = computed(() => mode.value === 'direct' ? { ...form } : { name: form.name, email: form.email, roles: form.roles })
const creationForm = ref<BingFormExpose | null>(null)
const creationFormId = useId()
const showPassword = ref(false)
const created = ref<{ user: AccountUser; password: string } | null>(null)
const accountInformation = computed(() => created.value
  ? `姓名：${created.value.user.name}\n用户名：${created.value.user.username}\n邮箱：${created.value.user.email}\n初始密码：${created.value.password}` : '')
const busy = ref(false)
const copyingId = ref('')
const working = computed(() => busy.value || Boolean(copyingId.value))
const error = ref('')
const pageError = ref('')
const pageNotice = ref('')
const link = ref('')
const notice = ref('')
const reissuing = ref(false)
const linkUnavailable = ref(false)
function prepareForm(row?: BingTableRow) {
  Object.assign(form, { name: row?.name ?? '', email: row?.email ?? '', username: '', password: '', systemRole: 'user', roles: row ? [...row.roles as ProjectRole[]] : [] })
  created.value = null
  showPassword.value = false
  creationForm.value?.clearValidate()
  reissuing.value = Boolean(row)
  linkUnavailable.value = false
  link.value = ''
  error.value = ''
  notice.value = ''
  pageError.value = ''
  pageNotice.value = ''
}
function create(row?: BingTableRow, direct = false) {
  if (working.value) return
  prepareForm(row)
  mode.value = direct ? 'direct' : 'invite'
  open.value = true
}
watch(() => props.openRequest, () => {
  if (props.openRequest) { create(undefined, true); emit('opened') }
}, { immediate: true })
watch(mode, () => {
  form.password = ''
  showPassword.value = false
  error.value = ''
  notice.value = ''
  creationForm.value?.clearValidate()
})
watch(open, (value) => {
  if (value) return
  const completed = Boolean(created.value)
  created.value = null
  form.password = ''
  link.value = ''
  if (completed) emit('userCreated')
})
async function generatePassword() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  form.password = Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => alphabet[byte & 63]).join('')
  showPassword.value = true
  await nextTick()
  await creationForm.value?.validateField('password')
}
async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'direct') {
      const input = managedUserCreateSchema.parse(activeForm.value)
      const result = await $fetch<{ user: AccountUser }>('/api/admin/users', { method: 'POST', body: input })
      created.value = { user: result.user, password: input.password }
      form.password = ''
    } else {
      const result = await $fetch<{ invitation: Invitation; url: string }>('/api/admin/invitations', {
        method: 'POST', body: invitationInputSchema.parse(activeForm.value),
      })
      link.value = result.url
    }
    await refresh()
  } catch (err) { error.value = accountError(err) }
  finally { busy.value = false }
}
async function copyText(value: string, successMessage: string) {
  const operation = feedback.begin('正在复制')
  try {
    await navigator.clipboard.writeText(value)
    notice.value = successMessage
    operation.success(successMessage)
    return true
  } catch {
    notice.value = '请选中上方内容，手动复制'
    operation.error('复制失败，请选中面板中的内容手动复制。')
    return false
  }
}
const copy = () => copyText(link.value, '已复制邀请链接')
async function copyInvitation(row: BingTableRow) {
  if (working.value) return
  copyingId.value = String(row.id)
  pageError.value = ''
  pageNotice.value = ''
  const operation = feedback.begin(`正在获取 ${row.email} 的邀请链接`)
  try {
    const result = await $fetch<{ url: string | null }>(`/api/admin/invitations/${row.id}/link`, { method: 'POST', retry: 0, timeout: 15_000 })
    if (!operation.isCurrent()) return
    prepareForm(row)
    mode.value = 'invite'
    if (!result.url) {
      linkUnavailable.value = true
      open.value = true
      operation.warning('原邀请链接无法恢复，请在面板中明确重新邀请。')
      return
    }
    link.value = result.url
    try {
      await navigator.clipboard.writeText(link.value)
      operation.success('邀请链接已复制')
      pageNotice.value = '邀请链接已复制'
      link.value = ''
    } catch {
      operation.error('复制失败，请在邀请面板手动复制。')
      notice.value = '请选中上方内容，手动复制'
      open.value = true
    }
  } catch (err) { pageError.value = accountError(err); operation.error(`获取邀请链接失败：${pageError.value}`) }
  finally { copyingId.value = '' }
}
function confirmRevoke(row: BingTableRow) {
  if (working.value) return
  revoking.value = row as unknown as Invitation
  error.value = ''; pageError.value = ''; pageNotice.value = ''; revokeOpen.value = true
}
async function revoke() {
  if (!revoking.value || busy.value) return
  const target = revoking.value
  busy.value = true
  error.value = ''
  revokeOpen.value = false
  const operation = feedback.begin(`正在撤销发给 ${target.email} 的邀请`)
  try {
    await $fetch(`/api/admin/invitations/${target.id}/revoke`, { method: 'POST', body: {}, retry: 0, timeout: 15_000 })
    operation.success(`发给 ${target.email} 的邀请已撤销`)
    if (!operation.isCurrent()) return
    pageError.value = ''; pageNotice.value = `发给 ${target.email} 的邀请已撤销`
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error(`撤销 ${target.email} 的邀请失败：${message}`)
    if (operation.isCurrent()) { revoking.value = target; error.value = message; pageError.value = `撤销邀请失败：${message}` }
  }
  finally { busy.value = false }
}
</script>

<template>
  <div class="account-toolbar"><p class="account-hint">邀请有效期为 7 天。复制链接发给同事，由同事设置自己的密码。</p><BingButton variant="secondary" :disabled="working" @click="create()">创建邀请</BingButton></div>
  <p v-if="loadError" class="account-error" role="alert">{{ accountError(loadError) }}</p>
  <p v-if="pageError" class="account-error" role="alert">{{ pageError }}</p>
  <BingButton v-if="pageError && revoking && !revokeOpen" size="sm" variant="ghost" @click="revokeOpen = true">重试撤销邀请</BingButton>
  <p v-if="pageNotice" class="account-success" role="status">{{ pageNotice }}</p>
  <div class="account-table-card">
    <BingTable
      v-model:page="page" v-model:page-size="pageSize"
      :data="rows" :columns="columns" :loading="pending"
      pagination remote-pagination :total="data?.total ?? 0"
      empty-text="暂无邀请，点击「新增用户」邀请第一位同事" aria-label="邀请记录"
    >
      <template #cell-identity="{ row }"><div class="account-cell-identity"><strong>{{ row.name }}</strong><small>{{ row.email }}</small></div></template>
      <template #cell-roles="{ row }">{{ roleText(row.roles as ProjectRole[]) }}</template>
      <template #cell-status="{ row }"><span class="account-badge" :class="{ 'account-badge--green': row.status === 'accepted' }">{{ labels[row.status as keyof typeof labels] }}</span></template>
      <template #cell-expiresAt="{ row }"><span class="account-hint">{{ accountDate(String(row.expiresAt)) }}</span></template>
      <template #cell-actions="{ row }">
        <div v-if="row.status !== 'accepted'" class="account-actions">
          <BingButton v-if="row.status === 'pending'" size="sm" variant="ghost" :loading="copyingId === row.id" :disabled="working" @click="copyInvitation(row)">复制邀请链接</BingButton>
          <BingButton size="sm" variant="ghost" :disabled="working" @click="create(row)">重新邀请</BingButton>
          <BingButton v-if="row.status === 'pending'" size="sm" variant="ghost" :disabled="working" @click="confirmRevoke(row)">撤销</BingButton>
        </div>
        <span v-else class="account-hint">已加入项目</span>
      </template>
    </BingTable>
  </div>
  <BingDialog :busy="busy" v-model="open" :title="created ? '账号已创建' : link ? '邀请链接' : reissuing ? '重新邀请成员' : '新增用户'" :width="600" :close-on-overlay="false">
    <div v-if="created" class="account-stack">
      <p>{{ created.user.name }} 的账号已启用，可以直接登录，无需审批。</p>
      <label for="created-account-information">账号信息</label>
      <BingTextarea id="created-account-information" :model-value="accountInformation" :rows="5" readonly block @focus="($event.target as HTMLTextAreaElement).select()" />
      <p class="account-hint">请将账号信息交给本人。初始密码仅在本次创建后展示，关闭后无法查看；用户可从右上角「修改密码」更换。</p>
      <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
    </div>
    <div v-else-if="link" class="account-stack">
      <p>将完整链接发给 {{ form.name }}（{{ form.email }}）。对方可以注册新账号，或登录已有账号接受邀请。</p>
      <label for="invitation-link">邀请链接</label>
      <BingTextarea id="invitation-link" :model-value="link" :rows="3" readonly block @focus="($event.target as HTMLTextAreaElement).select()" />
      <p class="account-hint">有效期内可从邀请记录再次复制；重新邀请会使此前链接失效。</p>
      <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
    </div>
    <BingForm v-else :id="creationFormId" ref="creationForm" :model="activeForm" :schema="mode === 'direct' ? managedUserCreateSchema : invitationInputSchema" layout="stack" :disabled="busy" @submit="submit">
      <BingTabs v-if="!reissuing" v-model="mode" :items="modes" :disabled="busy" aria-label="新增用户方式" />
      <p v-if="linkUnavailable" class="account-notice" role="status">这条邀请的原链接无法恢复，请生成新链接。生成后旧链接将失效，取消则保留原邀请。</p>
      <p v-else-if="reissuing" class="account-notice">确认后，该邮箱此前尚未接受的邀请链接将失效。</p>
      <p v-else class="account-hint">{{ mode === 'direct' ? '创建后立即加入项目，无需审批。' : '生成邀请链接，由成员自己设置账号和密码。' }}</p>
      <BingFormItem prop="name" label="姓名" required><BingInput v-model="form.name" placeholder="同事的姓名" autocomplete="off" block /></BingFormItem>
      <BingFormItem v-if="mode === 'direct'" prop="username" label="用户名" required><BingInput v-model="form.username" placeholder="3–30 位字母、数字、下划线或点" autocomplete="off" block /></BingFormItem>
      <BingFormItem prop="email" label="邮箱" required><BingInput v-model="form.email" type="email" placeholder="name@example.com" autocomplete="off" block :disabled="busy || linkUnavailable" /></BingFormItem>
      <BingFormItem v-if="mode === 'direct'" prop="password" label="初始密码" required>
        <BingInput v-model="form.password" :type="showPassword ? 'text' : 'password'" :password-toggle="false" placeholder="6–128 个字符" autocomplete="new-password" block />
        <div class="account-actions"><BingButton size="sm" variant="ghost" :disabled="busy" @click="showPassword = !showPassword">{{ showPassword ? '隐藏密码' : '显示密码' }}</BingButton><BingButton size="sm" variant="secondary" :disabled="busy" @click="generatePassword">随机生成密码</BingButton></div>
      </BingFormItem>
      <BingFormItem v-if="mode === 'direct'" prop="systemRole" label="系统身份" required><BingSelect v-model="form.systemRole" :options="systemOptions" :clearable="false" block /></BingFormItem>
      <BingFormItem prop="roles" label="项目角色（可多选）" help="可同时担任多个角色；不选角色也可以作为普通成员参与文档编辑。"><BingCheckboxGroup v-model="form.roles" :options="roleOptions" aria-label="项目角色" /></BingFormItem>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    </BingForm>
    <template #footer>
      <template v-if="created">
        <BingButton variant="secondary" :disabled="busy" @click="open = false">完成</BingButton>
        <BingButton @click="copyText(accountInformation, '已复制账号信息')">复制账号信息</BingButton>
      </template>
      <template v-else-if="link">
        <BingButton variant="secondary" @click="open = false; link = ''">完成</BingButton>
        <BingButton @click="copy">复制邀请链接</BingButton>
      </template>
      <template v-else>
        <BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton>
        <BingButton html-type="submit" :form="creationFormId" :loading="busy">{{ mode === 'direct' ? '创建账号' : '生成邀请链接' }}</BingButton>
      </template>
    </template>
  </BingDialog>
  <BingDialog v-model="revokeOpen" title="撤销邀请" :confirm-loading="busy" :close-on-confirm="false" :close-on-overlay="false" @confirm="revoke">
    <p>撤销发给 {{ revoking?.email }} 的邀请？该链接将无法继续使用。</p>
    <p v-if="error" class="account-error" role="alert">{{ error }}</p>
  </BingDialog>
</template>
