<script setup lang="ts">
import { BingButton } from '@moubing/bing-ui'
import type { AccountAccess, Invitation } from '#shared/auth/access'
import AccountShell from '~/components/accounts/AccountShell.vue'
import RegistrationForm from '~/components/accounts/RegistrationForm.vue'
import { accountDate, accountError, roleText } from '~/utils/account-display'
import { authClient } from '~/lib/auth-client'

const storageKey = 'requirement-board:invitation'
const token = ref('')
const invitation = ref<Invitation | null>(null)
const access = useAccountAccessState()
const session = useAuthSessionState()
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const matchesEmail = computed(() => access.value?.user.email.toLowerCase() === invitation.value?.email)
useHead({ title: '接受邀请 · 文档看板', meta: [{ name: 'referrer', content: 'no-referrer' }] })

onMounted(async () => {
  try {
    const fragment = window.location.hash.slice(1)
    token.value = fragment || sessionStorage.getItem(storageKey) || ''
    if (fragment) {
      sessionStorage.setItem(storageKey, fragment)
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
    if (!token.value) { error.value = '请打开管理员提供的完整邀请链接'; return }
    invitation.value = await $fetch<Invitation>('/api/invitations/preview', { method: 'POST', body: { token: token.value } })
  } catch (err) { error.value = accountError(err) }
  finally { loading.value = false }
})
async function accept() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    await $fetch('/api/invitations/accept', { method: 'POST', body: { token: token.value } })
    access.value = await $fetch<AccountAccess>('/api/account/access')
    sessionStorage.removeItem(storageKey)
    await navigateTo('/')
  } catch (err) { error.value = accountError(err) }
  finally { busy.value = false }
}
async function switchAccount() {
  busy.value = true
  try {
    const result = await authClient.signOut()
    if (result.error) { error.value = '退出失败，请重试'; return }
    session.value = null
    access.value = null
    await navigateTo('/login?redirect=/invite')
  } catch (err) { error.value = accountError(err) }
  finally { busy.value = false }
}
</script>

<template>
  <AccountShell title="你收到了项目邀请" compact>
    <div class="account-card account-stack">
      <p v-if="loading" role="status">正在确认邀请…</p>
      <template v-if="invitation">
        <div class="account-notice">
          <strong>{{ invitation.name }}，欢迎加入文档工作台</strong>
          <p>受邀邮箱：{{ invitation.email }}</p>
          <p>项目角色：{{ roleText(invitation.roles) }}</p>
          <p class="account-hint">有效期至 {{ accountDate(invitation.expiresAt) }}</p>
        </div>
        <template v-if="access">
          <p>当前登录：{{ access.user.email }}</p>
          <BingButton v-if="matchesEmail" :loading="busy" @click="accept">接受邀请并进入项目</BingButton>
          <template v-else>
            <p class="account-hint">请使用受邀邮箱对应的账号接受邀请。</p>
            <BingButton :loading="busy" @click="switchAccount">切换账号</BingButton>
          </template>
        </template>
        <template v-else>
          <p class="account-hint">已有账号？<NuxtLink to="/login?redirect=/invite">登录后接受邀请</NuxtLink></p>
          <RegistrationForm :email="invitation.email" :name="invitation.name" invited @registered="accept" />
        </template>
      </template>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      <NuxtLink v-if="!invitation && !loading" :to="access ? '/account' : '/login'">返回{{ access ? '我的账号' : '登录' }}</NuxtLink>
    </div>
  </AccountShell>
</template>
