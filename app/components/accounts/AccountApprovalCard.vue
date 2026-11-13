<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { BingButton, BingForm, BingFormItem, BingTextarea } from '@moubing/bing-ui'
import type { BingFormSubmitPayload } from '@moubing/bing-ui'
import { Check, Clock3, X } from 'lucide-vue-next'
import { accessRequestSchema } from '#shared/auth/account-input'
import type { AccountAccess } from '#shared/auth/access'
import { accountError } from '~/utils/account-display'
import { useOperationFeedback } from '~/composables/use-operation-feedback'

const access = defineModel<AccountAccess>({ required: true })
const feedback = useOperationFeedback()
const route = useRoute()
const form = reactive({ message: access.value.request?.message ?? '' })
const busy = ref(false)
const refreshing = ref(false)
const error = ref('')
const refreshError = ref('')
const notice = ref('')
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined
const controller = new AbortController()
const current = (id: string, path: string) => !disposed && access.value.user.id === id && route.fullPath === path

async function enterProject(updated: AccountAccess, operation = feedback.begin('审批状态已更新')) {
  clearInterval(timer)
  access.value = updated
  operation.success('审批已通过，可以进入项目')
  // 资格更新会卸载此卡片，导航失败必须由页面外的操作提示继续报告。
  try { await navigateTo('/') } catch { operation.warning('审批状态已刷新，请刷新页面后进入项目。') }
}

async function refresh(silent = false) {
  if (busy.value || refreshing.value || access.value.canAccessProject || (silent && document.visibilityState !== 'visible')) return
  refreshing.value = true
  refreshError.value = ''
  const id = access.value.user.id, path = route.fullPath
  const operation = silent ? null : feedback.begin('正在刷新审批状态')
  try {
    const updated = await $fetch<AccountAccess>('/api/account/access', { retry: 0, timeout: 15_000, signal: controller.signal })
    if (!current(id, path) || updated.user.id !== id) return
    if (updated.canAccessProject) {
      await enterProject(updated, operation ?? undefined)
    } else {
      access.value = updated
      if (!silent) { notice.value = '已更新申请状态'; operation?.success('审批状态已更新') }
    }
  } catch (err) {
    if (!current(id, path)) return
    refreshError.value = accountError(err)
    operation?.error(`审批状态刷新失败：${refreshError.value}`)
  } finally { refreshing.value = false }
}

async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value || refreshing.value) return
  const updatingMessage = access.value.request?.status === 'pending'
  const id = access.value.user.id, path = route.fullPath
  const input = accessRequestSchema.parse(form)
  busy.value = true; error.value = ''; notice.value = ''
  const operation = feedback.begin(updatingMessage ? '正在保存申请说明' : '正在提交加入申请')
  try {
    await $fetch('/api/account/request', { method: 'POST', body: input, retry: 0, timeout: 15_000, signal: controller.signal })
    operation.success(updatingMessage ? '申请说明已保存，请等待管理员审批' : '申请已提交，请等待管理员审批')
    if (!current(id, path)) return
    notice.value = updatingMessage ? '申请说明已保存，请等待管理员审批' : '申请已提交，请等待管理员审批'
    await operation.refresh(async () => {
      const updated = await $fetch<AccountAccess>('/api/account/access', { retry: 0, timeout: 15_000, signal: controller.signal })
      if (current(id, path) && updated.user.id === id) {
        if (updated.canAccessProject) await enterProject(updated)
        else access.value = updated
      }
    })
  } catch (err) {
    if (!current(id, path)) return
    error.value = accountError(err)
    operation.error(`申请未保存：${error.value}，输入已保留。`)
  } finally { busy.value = false }
}

watch(() => access.value.user.id, () => {
  form.message = access.value.request?.message ?? ''
  error.value = ''; refreshError.value = ''; notice.value = ''
})
onMounted(() => { timer = setInterval(() => { void refresh(true) }, 60_000) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); controller.abort() })
</script>

<template>
  <section class="account-card account-stack account-approval" aria-labelledby="account-approval-title">
    <h2 id="account-approval-title">项目加入进度</h2>
    <ol class="account-approval-steps" aria-label="项目审批进度">
      <li class="is-complete"><span><Check :size="16" aria-hidden="true" /></span>已注册</li>
      <li :class="access.request?.status === 'rejected' ? 'is-rejected' : 'is-current'" aria-current="step"><span><component :is="access.request?.status === 'rejected' ? X : Clock3" :size="16" aria-hidden="true" /></span>{{ access.request?.status === 'rejected' ? '申请被拒绝' : '等待审批' }}</li>
      <li><span>3</span>已加入</li>
    </ol>
    <p>你好，{{ access.user.name }}。账号已创建，审批通过后即可访问项目文档。</p>
    <p v-if="access.request?.reviewNote" class="account-notice" :class="{ 'account-error': access.request.status === 'rejected' }">管理员回复：{{ access.request.reviewNote }}</p>
    <BingForm :model="form" :schema="accessRequestSchema" layout="stack" :disabled="busy" @submit="submit">
      <BingFormItem prop="message" label="加入说明（选填）"><BingTextarea v-model="form.message" :max-length="1000" :rows="3" placeholder="介绍你所在的团队或承担的工作，方便管理员确认。" /></BingFormItem>
      <div class="account-actions">
        <BingButton html-type="submit" :loading="busy" :disabled="refreshing">{{ access.request?.status === 'rejected' ? '重新申请加入' : '保存申请说明' }}</BingButton>
        <BingButton variant="secondary" :disabled="busy" :loading="refreshing" @click="refresh()">刷新审批状态</BingButton>
      </div>
    </BingForm>
    <p class="account-hint">收到管理员的邀请链接后，也可以直接打开链接加入项目。</p>
    <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
    <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    <div v-if="refreshError" class="account-error" role="alert">{{ refreshError }}<BingButton variant="ghost" size="sm" :disabled="busy || refreshing" @click="refresh()">重试刷新审批状态</BingButton></div>
  </section>
</template>
