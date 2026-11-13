<script setup lang="ts">
import { BingButton, BingTabs } from '@moubing/bing-ui'
import type { BingTabValue } from '@moubing/bing-ui'
import AccountShell from '~/components/accounts/AccountShell.vue'
import UsersPanel from '~/components/accounts/UsersPanel.vue'
import RequestsPanel from '~/components/accounts/RequestsPanel.vue'
import InvitationsPanel from '~/components/accounts/InvitationsPanel.vue'
const tabs = [
  { value: 'users', label: '团队账号' },
  { value: 'requests', label: '加入申请' },
  { value: 'invitations', label: '邀请记录' },
]
const tab = ref<BingTabValue>('users')
const inviteRequested = ref(false)
function invite() { inviteRequested.value = true }
async function userCreated() {
  tab.value = 'users'
  await nextTick()
  await refreshNuxtData('managed-users')
}
useHead({ title: '用户管理 · 文档看板' })
</script>

<template>
  <AccountShell title="用户管理" description="管理团队账号、审批加入申请，并为成员分配项目角色。">
    <template #actions><BingButton @click="invite">＋ 新增用户</BingButton></template>
    <BingTabs v-model="tab" :items="tabs" aria-label="用户管理分类" />
    <UsersPanel v-if="tab === 'users'" />
    <RequestsPanel v-else-if="tab === 'requests'" />
    <div v-show="tab === 'invitations'"><InvitationsPanel :open-request="inviteRequested" @opened="inviteRequested = false" @user-created="userCreated" /></div>
  </AccountShell>
</template>
