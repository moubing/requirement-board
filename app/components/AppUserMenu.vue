<script setup lang="ts">
import { BingButton, BingDropDown, BingDropDownItem, BingIcon } from '@moubing/bing-ui'
import { ChevronDown, KeyRound, LogOut, Settings, UserRound } from 'lucide-vue-next'
import { authClient } from '~/lib/auth-client'
import ChangePasswordDialog from '~/components/accounts/ChangePasswordDialog.vue'

const session = useAuthSessionState()
const access = useAccountAccessState()
const open = ref(false)
const signingOut = ref(false)
const signOutError = ref('')
const changingPassword = ref(false)
const initial = computed(() => Array.from(session.value?.user.name.trim() ?? '')[0]?.toUpperCase() ?? '?')
const identity = computed(() => session.value?.user.role === 'admin'
  ? '系统管理员' : access.value?.canAccessProject ? '项目成员' : '暂无项目访问权限')

function followLink(event: MouseEvent, path: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  open.value = false
  void navigateTo(path)
}

async function signOut() {
  if (signingOut.value) return
  signOutError.value = ''
  signingOut.value = true
  try {
    const result = await authClient.signOut()
    if (result.error) { signOutError.value = '退出失败，请重试'; return }
    open.value = false
    try {
      await navigateTo('/login')
    } finally {
      // 正常导航与登录页一起提交；即使导航失败或取消，也不能保留已退出的身份。
      session.value = null
      access.value = null
    }
  } catch {
    signOutError.value = '退出失败，请重试'
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div v-if="session?.user" class="app-user-menu">
    <BingDropDown v-model:open="open" placement="bottom-end" :min-width="230" ariaLabel="用户菜单">
      <template #trigger="{ triggerProps }">
        <BingButton v-bind="triggerProps" variant="ghost" size="lg" :throttle="false"
          class="app-user-trigger app-header-control" :title="session.user.name" :aria-label="`用户菜单：${session.user.name}`">
          <span class="app-header-button-content"><span class="app-user-avatar" aria-hidden="true">{{ initial }}</span>
            <span class="app-user-trigger__name app-header-action-label">{{ session.user.name }}</span>
            <BingIcon class="app-header-action-label" :icon="ChevronDown" :size="14" decorative />
          </span>
        </BingButton>
      </template>
      <div class="app-user-menu__identity">
        <strong>{{ session.user.name }}</strong>
        <span>{{ session.user.email }}</span>
        <span>{{ identity }}</span>
      </div>
      <BingDropDownItem title="个人账号" :icon="UserRound" href="/account" :disabled="signingOut" @click="followLink($event, '/account')" />
      <BingDropDownItem title="修改密码" :icon="KeyRound" :disabled="signingOut" @click="changingPassword = true" />
      <BingDropDownItem v-if="session.user.role === 'admin'" title="系统管理" :icon="Settings" href="/admin/users" :disabled="signingOut" @click="followLink($event, '/admin/users')" />
      <BingDropDownItem :title="signingOut ? '正在退出…' : '退出登录'" :icon="LogOut" :disabled="signingOut" :close-on-click="false" @click="signOut" />
      <p v-if="signOutError" class="app-user-menu__error" role="alert">{{ signOutError }}</p>
    </BingDropDown>
    <ChangePasswordDialog v-model="changingPassword" />
  </div>
</template>
