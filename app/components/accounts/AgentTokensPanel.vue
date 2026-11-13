<script setup lang="ts">
import { BingButton, BingDialog, BingForm, BingFormItem, BingInput, BingSelect, BingTable, BingTabs } from '@moubing/bing-ui'
import type { BingFormExpose, BingFormSubmitPayload, BingTableColumn, BingTablePageChangePayload, BingTabValue } from '@moubing/bing-ui'
import { Check, Copy, KeyRound, LockKeyhole, Plus, TriangleAlert } from 'lucide-vue-next'
import { agentTokenInputSchema, agentTokenStatus, type AgentTokenDto } from '#shared/agent/tokens'
import { useAgentTokenPage } from '~/composables/use-agent-token-page'
import { useCopyFeedback } from '~/composables/use-copy-feedback'
import { accountError } from '~/utils/account-display'
import { useOperationFeedback } from '~/composables/use-operation-feedback'
import AgentSetupGuide from './AgentSetupGuide.vue'

const props = defineProps<{ userId: string }>()
const feedback = useOperationFeedback()
const { copied, markCopied, resetCopied } = useCopyFeedback()
const form = reactive({ name: '', expiresInDays: 30 as number | null })
const expiryPreset = ref<BingTabValue>(30)
const expiryOptions = [{ value: 7, label: '7 天' }, { value: 30, label: '30 天' }, { value: 90, label: '90 天' }, { value: 'custom', label: '自定义' }]
const createOpen = ref(false)
const createForm = ref<BingFormExpose | null>(null)
const formId = useId()
const createError = ref('')
const { data, overview, query, committedQuery, pending, error: loadError, load, retry } = useAgentTokenPage()
const labels = { active: '有效', expired: '已过期', revoked: '已撤销' }
const filters = computed(() => Object.entries(labels).map(([value, label]) => ({ value, label: label + ' (' + (overview.value?.counts[value as keyof typeof labels] ?? '—') + ')' })))
const rows = computed(() => data.value?.items.map(token => {
  const status = agentTokenStatus(token, data.value!.asOf)
  const days = Math.max(0, Math.ceil((Date.parse(token.expiresAt) - Date.parse(data.value!.asOf)) / 86400_000))
  return { ...token, status, days, expiring: status === 'active' && days <= 7 }
}) ?? [])
const expiringCount = computed(() => overview.value?.activeTokens.filter(token =>
  agentTokenStatus(token, overview.value!.asOf) === 'active' && Date.parse(token.expiresAt) - Date.parse(overview.value!.asOf) <= 7 * 86400_000).length ?? 0)
const showPagination = computed(() => (data.value?.total ?? 0) > committedQuery.value.limit)
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / committedQuery.value.limit)))
const columns: BingTableColumn[] = [
  { key: 'name', title: '名称', minWidth: 120 }, { key: 'status', title: '状态', width: 70, minWidth: 70 },
  { key: 'createdAt', title: '创建日期', width: 110 }, { key: 'expiresAt', title: '到期日期', minWidth: 128 },
  { key: 'actions', title: '操作', width: 96, align: 'right' },
]
const revoking = ref<AgentTokenDto | null>(null)
const revokeOpen = ref(false)
const revokeError = ref('')
const busy = ref(false)
const secret = ref('')
const copyError = ref('')
const notice = ref('')
const createDisabled = computed(() => busy.value || !overview.value || overview.value.counts.active >= 10)
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined

watch(createOpen, value => {
  secret.value = ''; copyError.value = ''; resetCopied()
  if (!value) return
  Object.assign(form, { name: '', expiresInDays: 30 })
  expiryPreset.value = 30
  createError.value = ''
  createForm.value?.clearValidate()
})
onMounted(() => {
  void load()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && !pending.value && !busy.value && !createOpen.value && !revokeOpen.value) void load()
  }, 60_000)
})
onBeforeUnmount(() => { disposed = true; secret.value = ''; clearInterval(timer) })

function changeStatus(value: BingTabValue) {
  if (value === 'active' || value === 'expired' || value === 'revoked') void load({ ...query.value, page: 1, status: value })
}
function changePage({ page, pageSize }: BingTablePageChangePayload) {
  void load({ ...query.value, page: pageSize === query.value.limit ? page : 1, limit: pageSize })
}
function changeExpiry(value: BingTabValue) {
  expiryPreset.value = value
  if (typeof value === 'number') form.expiresInDays = value
}
async function create({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value) return
  busy.value = true; createError.value = ''; notice.value = ''
  try {
    const created = await $fetch<AgentTokenDto & { token: string }>('/api/account/agent-tokens', {
      method: 'POST', body: agentTokenInputSchema.parse(form), retry: 0, timeout: 15_000,
    })
    if (disposed) return
    secret.value = created.token
    await load({ page: 1, limit: query.value.limit, status: 'active' })
    if (loadError.value) notice.value = '凭证已创建，最新列表暂未加载，请稍后重试加载。'
  } catch (err) { if (!disposed) createError.value = accountError(err) }
  finally { busy.value = false }
}
function confirmRevoke(token: AgentTokenDto) {
  revoking.value = token; revokeError.value = ''; revokeOpen.value = true
}
async function revoke() {
  if (busy.value || !revoking.value) return
  const target = revoking.value
  busy.value = true; revokeError.value = ''; secret.value = ''; notice.value = ''
  revokeOpen.value = false
  const operation = feedback.begin('正在撤销 AI 凭证「' + target.name + '」')
  try {
    await $fetch('/api/account/agent-tokens/' + target.id + '/revoke', { method: 'POST', retry: 0, timeout: 15_000 })
    operation.success('AI 凭证「' + target.name + '」已撤销')
    if (disposed || !operation.isCurrent()) return
    notice.value = '凭证已撤销'
    void operation.refresh(() => load(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error('AI 凭证「' + target.name + '」撤销失败：' + message)
    if (!disposed && operation.isCurrent()) { revoking.value = target; revokeError.value = message }
  } finally { busy.value = false }
}
async function copy() {
  if (!secret.value) return
  copyError.value = ''
  const operation = feedback.begin('正在复制 AI 凭证')
  try {
    await navigator.clipboard.writeText(secret.value)
    if (disposed || !createOpen.value || !operation.isCurrent()) return
    markCopied('secret'); operation.success('AI 凭证已复制')
  } catch { if (!disposed) copyError.value = '复制失败，请选中上方凭证手动复制'; operation.error('复制失败，请选中凭证手动复制') }
}
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' })
</script>

<template>
  <div id="account-ai" class="agent-tokens" :class="{ 'agent-tokens--paginated': showPagination }">
    <AgentSetupGuide :user-id="props.userId" :active-count="overview?.counts.active ?? null" :busy="createDisabled" @create="createOpen = true" />
    <section class="account-card agent-credentials" aria-labelledby="agent-credentials-title">
      <div class="agent-heading">
        <div><h2 id="agent-credentials-title">AI 访问凭证</h2><p class="account-hint" aria-label="有效凭证数量">{{ overview ? overview.counts.active + ' / 10' : '— / 10' }} 个有效凭证</p></div>
        <BingButton :disabled="createDisabled" @click="createOpen = true"><template #prefix><Plus :size="16" aria-hidden="true" /></template>创建凭证</BingButton>
      </div>
      <p v-if="expiringCount" class="agent-expiry-warning" role="status"><TriangleAlert :size="16" aria-hidden="true" />有凭证即将到期：{{ expiringCount }} 个凭证将在 7 天内到期，请及时创建新凭证并更新本机配置。</p>
      <BingTabs class="agent-token-filter" :model-value="committedQuery.status" :items="filters" variant="soft" size="sm" :disabled="busy" aria-label="凭证状态筛选" @update:model-value="changeStatus" />
      <div v-if="loadError" class="account-error" role="alert">
        {{ accountError(loadError) }}{{ data ? '；仍显示上次成功加载的结果。' : '' }}
        <BingButton variant="ghost" size="sm" :disabled="pending" @click="retry">重试加载凭证</BingButton>
      </div>
      <div v-if="!data && pending" class="agent-token-skeleton account-skeleton" role="status" aria-label="正在加载凭证">
        <span v-for="n in 4" :key="n" class="account-skeleton-line" /><span class="sr-only">正在加载凭证</span>
      </div>
      <div v-else-if="data && !rows.length" class="agent-token-empty">
        <div class="agent-empty-art" aria-hidden="true"><KeyRound :size="30" /><span /><span /></div>
        <h4>{{ committedQuery.status === 'active' ? '还没有凭证' : '没有' + labels[committedQuery.status as keyof typeof labels] + '的凭证' }}</h4>
        <p class="account-hint">{{ committedQuery.status === 'active' ? '创建访问凭证，让本机 Codex 开始文档协作。' : '此状态下的凭证会显示在这里。' }}</p>
        <BingButton v-if="committedQuery.status === 'active'" variant="secondary" :disabled="createDisabled" @click="createOpen = true">创建第一个凭证</BingButton>
      </div>
      <template v-else-if="data">
        <div class="agent-token-desktop">
        <BingTable class="agent-token-table" :data="rows" :columns="columns" :loading="pending" size="md" :striped="false" max-height="var(--account-token-table-height, none)"
          :pagination="showPagination" remote-pagination :show-column-controls="false" :preserve-page-height="false"
          :page="committedQuery.page" :page-size="committedQuery.limit" :page-size-options="[10, 20, 50]" :total="data.total"
          aria-label="AI 访问凭证" @page-change="changePage">
          <template #cell-status="{ row }"><span class="agent-token-status" :class="'agent-token-status--' + row.status">{{ labels[row.status as keyof typeof labels] }}</span></template>
          <template #cell-createdAt="{ row }">{{ date(String(row.createdAt)) }}</template>
          <template #cell-expiresAt="{ row }"><div class="agent-expiry" :class="{ 'is-expiring': row.expiring }"><time :datetime="String(row.expiresAt)" :title="new Date(String(row.expiresAt)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })">{{ date(String(row.expiresAt)) }}</time><small v-if="row.status === 'active'">剩 {{ row.days }} 天</small></div></template>
          <template #cell-actions="{ row }"><BingButton v-if="row.status === 'active'" class="agent-token-revoke" variant="ghost" size="sm" :disabled="busy" :aria-label="'撤销 ' + row.name" @click="confirmRevoke(row as unknown as AgentTokenDto)">撤销</BingButton><span v-else class="account-hint">—</span></template>
        </BingTable>
        </div>
        <div class="agent-token-mobile" :aria-busy="pending">
          <ul class="agent-token-cards" aria-label="AI 访问凭证">
            <li v-for="row in rows" :key="row.id">
              <div class="agent-heading"><strong>{{ row.name }}</strong><span class="agent-token-status" :class="'agent-token-status--' + row.status">{{ labels[row.status as keyof typeof labels] }}</span></div>
              <dl><div><dt>创建日期</dt><dd>{{ date(row.createdAt) }}</dd></div><div><dt>到期日期</dt><dd class="agent-expiry" :class="{ 'is-expiring': row.expiring }"><time :datetime="row.expiresAt">{{ date(row.expiresAt) }}</time><small v-if="row.status === 'active'">剩 {{ row.days }} 天</small></dd></div></dl>
              <BingButton v-if="row.status === 'active'" class="agent-token-revoke" variant="ghost" size="sm" :disabled="busy" :aria-label="'撤销 ' + row.name" @click="confirmRevoke(row)">撤销</BingButton>
            </li>
          </ul>
          <div v-if="showPagination" class="agent-mobile-pagination" aria-label="凭证分页">
            <div><BingButton variant="secondary" size="sm" :disabled="pending || committedQuery.page <= 1" @click="changePage({ page: committedQuery.page - 1, pageSize: committedQuery.limit })">上一页</BingButton><span role="status">{{ committedQuery.page }} / {{ pages }}</span><BingButton variant="secondary" size="sm" :disabled="pending || committedQuery.page >= pages" @click="changePage({ page: committedQuery.page + 1, pageSize: committedQuery.limit })">下一页</BingButton></div>
            <BingSelect :model-value="committedQuery.limit" :options="[10, 20, 50].map(value => ({ value, label: value + ' 条/页' }))" :clearable="false" :searchable="false" :disabled="pending" aria-label="每页凭证数量" @update:model-value="value => typeof value === 'number' && changePage({ page: 1, pageSize: value })" />
          </div>
        </div>
      </template>
      <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
      <p v-if="revokeError && !revokeOpen" class="account-error" role="alert">{{ revoking?.name }}：{{ revokeError }}<BingButton size="sm" variant="ghost" @click="revokeOpen = true">重试撤销凭证</BingButton></p>
      <p class="agent-token-note account-hint"><LockKeyhole :size="16" aria-hidden="true" /><span>凭证仅在创建时完整显示，权限跟随你的账号与项目访问。</span></p>
      <p class="agent-version-note account-hint">AI 编辑后，仅在明确要求保存版本时生成正式版本。</p>
      <span class="sr-only" role="status">{{ pending ? '正在加载凭证' : data ? labels[committedQuery.status as keyof typeof labels] + '凭证，共 ' + data.total + ' 个' : '' }}</span>
    </section>
  </div>
  <BingDialog :busy="busy" v-model="createOpen" :title="secret ? '凭证已创建' : '创建凭证'" :width="480" :height="480" :max-width="480" :max-height="480" :show-peek="false" :close-on-overlay="false">
    <div v-if="secret" class="account-stack">
      <p class="agent-secret-warning" role="status"><LockKeyhole :size="20" aria-hidden="true" /><span>凭证已创建。完整凭证只显示这一次，关闭后无法再次查看。</span></p>
      <p class="account-hint">请复制后粘贴到终端安装向导的 Token 提示中。</p>
      <div class="agent-secret-copy"><BingInput :model-value="secret" readonly aria-label="新建 AI 凭证" block :spellcheck="false" /><BingButton variant="secondary" aria-label="复制凭证" @click="copy"><template #prefix><component :is="copied.includes('secret') ? Check : Copy" :size="16" aria-hidden="true" /></template>{{ copied.includes('secret') ? '已复制' : '复制' }}</BingButton></div>
      <p v-if="copyError" class="account-error" role="alert">{{ copyError }}</p>
      <p v-if="copied.includes('secret')" class="account-success" role="status">凭证已复制</p>
    </div>
    <BingForm v-else :id="formId" ref="createForm" :model="form" :schema="agentTokenInputSchema" layout="stack" :disabled="busy" @submit="create">
      <BingFormItem prop="name" label="凭证名称" required><BingInput v-model="form.name" placeholder="例如：我的工作电脑" :maxlength="80" block /></BingFormItem>
      <BingFormItem prop="expiresInDays" label="有效期" required help="默认 30 天，可设置 1–90 天。">
        <BingTabs :model-value="expiryPreset" :items="expiryOptions" variant="soft" size="sm" :disabled="busy" aria-label="凭证有效期" @update:model-value="changeExpiry" />
        <BingInput v-if="expiryPreset === 'custom'" v-model="form.expiresInDays" type="number" :min="1" :max="90" :step="1" aria-label="自定义有效期（天）" block />
      </BingFormItem>
      <p v-if="createError" class="account-error" role="alert">{{ createError }}</p>
    </BingForm>
    <template #footer>
      <BingButton v-if="secret" :disabled="busy" @click="createOpen = false">完成</BingButton>
      <template v-else><BingButton variant="secondary" :disabled="busy" @click="createOpen = false">取消</BingButton><BingButton html-type="submit" :form="formId" :loading="busy">创建凭证</BingButton></template>
    </template>
  </BingDialog>
  <BingDialog v-model="revokeOpen" title="撤销凭证" cancel-text="取消" confirm-text="确认撤销" :width="480" :close-on-confirm="false" :confirm-loading="busy" :close-on-overlay="false" @confirm="revoke">
    <p>确认撤销「{{ revoking?.name }}」？</p><p>撤销后使用该凭证的 AI 将立即失去访问权限。该操作不可恢复，其他凭证不受影响，本机 Skill 不会被卸载。</p>
    <p v-if="revokeError" class="account-error" role="alert">{{ revokeError }}</p>
  </BingDialog>
</template>

<style scoped>
.agent-tokens { display: grid; align-items: start; gap: var(--account-panel-gap, 12px); min-width: 0; }
.agent-credentials { padding: 16px; min-width: 0; }
.agent-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.agent-heading h2 { margin: 0; font-size: 15px; font-weight: 650; }
.agent-heading p { margin: 4px 0 0; }
.agent-token-filter { max-width: 100%; margin: 12px 0 10px; }
.agent-token-table { --bing-table-header-bg: var(--ui-navigation); --bing-table-fixed-header-bg: var(--ui-navigation); }
.agent-token-status { display: inline-flex; align-items: center; gap: 6px; color: var(--bing-muted); white-space: nowrap; font-size: 12px; }
.agent-token-status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.agent-token-status--active { color: var(--bing-success-strong); }
.agent-token-status--expired, .is-expiring { color: var(--bing-warning-strong); }
.agent-expiry { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.agent-expiry small { font-size: 12px; white-space: nowrap; }
.agent-expiry-warning, .agent-secret-warning { display: flex; gap: 8px; align-items: flex-start; padding: 12px; background: var(--bing-warning-soft); color: var(--bing-warning-strong); border-radius: 6px; font-size: 12px; line-height: 1.7; }
.agent-expiry-warning svg, .agent-secret-warning svg { flex-shrink: 0; margin-top: 2px; }
.agent-token-revoke { color: var(--bing-danger-strong); }
.agent-token-note { display: flex; align-items: flex-start; gap: 8px; margin: 12px 0 0; }
.agent-token-note svg { flex-shrink: 0; margin-top: 2px; }
.agent-version-note { margin: 6px 0 0 24px; }
.agent-token-skeleton { min-height: 180px; }
.agent-token-empty { display: grid; justify-items: center; text-align: center; gap: 10px; padding: 28px 12px; }
.agent-token-empty h4, .agent-token-empty p { margin: 0; }
.agent-empty-art { display: flex; flex-direction: column; justify-content: center; gap: 5px; width: 80px; height: 68px; padding: 12px; border: 1px solid var(--bing-border); border-radius: 8px; background: var(--bing-surface-muted); color: var(--ui-accent); }
.agent-empty-art span { height: 2px; width: 30px; background: var(--bing-border); align-self: flex-end; }
.agent-empty-art span:last-child { width: 20px; }
.agent-secret-copy { display: flex; align-items: center; gap: 8px; min-width: 0; }
.agent-secret-copy > :first-child { flex: 1; min-width: 0; }
.agent-token-mobile { display: none; }
@container account-sections (min-width: 980px) {
  /* 为资料区和凭证工具区留出高度，分页始终位于表格滚动区外。 */
  .agent-tokens { --account-token-table-height: clamp(160px, calc(100dvh - 550px), 445px); grid-template-columns: 380px minmax(0, 1fr); }
  .agent-tokens--paginated { --account-token-table-height: clamp(120px, calc(100dvh - 635px), 360px); }
}
@media (max-width: 640px) {
  .agent-credentials { padding: 16px; }
  .agent-token-desktop { display: none; }
  .agent-token-mobile { display: block; }
  .agent-token-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .agent-token-cards li { padding: 14px; border: 1px solid var(--bing-border); border-radius: 8px; min-width: 0; }
  .agent-token-cards strong { font-size: 13px; overflow-wrap: anywhere; }
  .agent-token-cards dl { display: grid; gap: 8px; font-size: 12px; margin: 12px 0 4px; }
  .agent-token-cards dl > div { display: flex; gap: 16px; align-items: baseline; justify-content: space-between; }
  .agent-token-cards dt { flex-shrink: 0; color: var(--bing-muted); }
  .agent-token-cards dd { margin: 0; text-align: right; align-items: flex-end; }
  .agent-mobile-pagination { display: grid; gap: 12px; margin-top: 16px; }
  .agent-mobile-pagination > div:first-child { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
}
</style>
