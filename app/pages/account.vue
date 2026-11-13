<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { BingButton } from '@moubing/bing-ui'
import { Check, Copy, KeyRound, Monitor, ShieldCheck } from 'lucide-vue-next'
import type { AccountAccess } from '#shared/auth/access'
import { PROJECT_ROLE_LABELS } from '#shared/auth/access'
import AccountApprovalCard from '~/components/accounts/AccountApprovalCard.vue'
import ChangePasswordDialog from '~/components/accounts/ChangePasswordDialog.vue'
import AgentTokensPanel from '~/components/accounts/AgentTokensPanel.vue'
import { accountError } from '~/utils/account-display'
import { useOperationFeedback } from '~/composables/use-operation-feedback'
import { useCopyFeedback } from '~/composables/use-copy-feedback'

const access = useAccountAccessState()
const feedback = useOperationFeedback()
const { copied, markCopied } = useCopyFeedback()
const passwordOpen = ref(false)
const loading = ref(false)
const error = ref('')
const copyNotice = ref('')
let disposed = false
const controller = new AbortController()
useHead({ title: '我的账号 · 文档看板' })

async function loadAccount() {
  if (loading.value) return
  loading.value = true; error.value = ''
  try {
    const updated = await $fetch<AccountAccess>('/api/account/access', { retry: 0, timeout: 15_000, signal: controller.signal })
    if (!disposed) access.value = updated
  } catch (err) { if (!disposed) error.value = accountError(err) }
  finally { loading.value = false }
}
async function copyIdentity(key: 'username' | 'email') {
  const value = access.value?.user[key]
  if (!value) return
  const operation = feedback.begin('正在复制')
  try {
    await navigator.clipboard.writeText(value)
    if (disposed || !operation.isCurrent()) return
    markCopied(key); copyNotice.value = (key === 'username' ? '用户名' : '邮箱') + '已复制'
    operation.success(copyNotice.value)
  } catch { operation.error('复制失败，请选中文字手动复制。'); copyNotice.value = '复制失败，请选中文字手动复制。' }
}
onMounted(() => {
  if (!access.value) void loadAccount()
})
onBeforeUnmount(() => {
  disposed = true; controller.abort()
})
</script>

<template>
  <main class="account-page account-home">
    <h1 class="sr-only">我的账号</h1>
    <div class="account-main account-sections" :class="{ 'account-sections--joined': access?.canAccessProject }">
      <section v-if="!access" class="account-card account-profile-loading" aria-label="个人资料" :aria-busy="loading">
        <div v-if="!error" class="account-skeleton" role="status"><span class="account-skeleton-avatar" /><span class="account-skeleton-line" /><span class="account-skeleton-line" /><span class="sr-only">正在加载个人资料</span></div>
        <div v-else class="account-error" role="alert">{{ error }}<BingButton variant="secondary" @click="loadAccount">重试加载个人资料</BingButton></div>
      </section>
      <template v-else>
        <section id="account-profile" class="account-card account-profile-banner" aria-label="个人资料">
          <div class="account-identity">
            <span class="account-avatar" :style="{ '--account-avatar-color': access.user.avatarColor }" aria-hidden="true">{{ Array.from(access.user.name.trim())[0]?.toLocaleUpperCase() || '?' }}</span>
            <div class="account-identity-body">
              <h2>{{ access.user.name }}</h2>
              <div class="account-identity-contacts">
                <span class="account-copy-field"><span>{{ access.user.username ? '@' + access.user.username : '未设置用户名' }}</span><BingButton v-if="access.user.username" variant="ghost" size="xs" class="account-copy-button" :aria-label="copied.includes('username') ? '用户名已复制' : '复制用户名'" @click="copyIdentity('username')"><component :is="copied.includes('username') ? Check : Copy" :size="14" aria-hidden="true" /></BingButton></span>
                <span class="account-copy-field"><span>{{ access.user.email }}</span><BingButton variant="ghost" size="xs" class="account-copy-button" :aria-label="copied.includes('email') ? '邮箱已复制' : '复制邮箱'" @click="copyIdentity('email')"><component :is="copied.includes('email') ? Check : Copy" :size="14" aria-hidden="true" /></BingButton></span>
              </div>
            </div>
          </div>
          <div class="account-identity-roles">
            <div><span class="account-hint">系统身份</span><span class="account-badge" :class="{ 'account-badge--admin': access.user.role === 'admin' }">{{ access.user.role === 'admin' ? '超级管理员' : '普通用户' }}</span></div>
            <div v-if="access.canAccessProject"><span class="account-hint">项目角色</span><span v-for="role in access.projectRoles" :key="role" class="account-badge account-badge--role">{{ PROJECT_ROLE_LABELS[role] }}</span><span v-if="!access.projectRoles.length" class="account-badge account-badge--role">普通成员</span></div>
          </div>
          <span class="sr-only" role="status">{{ copyNotice }}</span>
        </section>
        <AccountApprovalCard v-if="!access.canAccessProject" :key="access.user.id" v-model="access" />
        <section id="account-security" class="account-card account-security" aria-labelledby="security-title">
          <h2 id="security-title"><ShieldCheck :size="18" aria-hidden="true" />账号安全</h2>
          <div class="account-security-row"><KeyRound :size="18" aria-hidden="true" /><div><h3>密码</h3><p>修改密码后，其他设备需重新登录</p></div><BingButton variant="secondary" @click="passwordOpen = true">修改密码</BingButton></div>
          <div class="account-security-row"><Monitor :size="18" aria-hidden="true" /><div><h3>登录设备</h3><p>设备查看与退出功能将在后续开放</p></div><span class="account-badge">暂未开放</span></div>
        </section>
        <AgentTokensPanel v-if="access.canAccessProject" :key="access.user.id" :user-id="access.user.id" />
      </template>
    </div>
    <ChangePasswordDialog v-model="passwordOpen" />
  </main>
</template>
