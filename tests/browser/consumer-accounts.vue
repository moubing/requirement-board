<script setup lang="ts">
import { ref } from 'vue'
import { BingButton } from '@moubing/bing-ui'
import Login from '../../app/pages/login.vue'
import Account from '../../app/pages/account.vue'
import AgentTokensPanel from '../../app/components/accounts/AgentTokensPanel.vue'
import InvitationsPanel from '../../app/components/accounts/InvitationsPanel.vue'
import ChangePasswordDialog from '../../app/components/accounts/ChangePasswordDialog.vue'
const panel = new URLSearchParams(location.search).get('panel')
const open = ref(false)
</script>

<template>
  <Login v-if="panel === 'login'" />
  <Account v-else-if="panel === 'account'" />
  <div v-else class="account-page">
    <AgentTokensPanel v-if="panel === 'tokens'" user-id="fixture-user" />
    <template v-else-if="panel === 'invitations'">
      <BingButton @click="open = true">新增用户</BingButton>
      <InvitationsPanel :open-request="open" @opened="open = false" />
    </template>
    <template v-else>
      <BingButton @click="open = true">修改密码</BingButton>
      <ChangePasswordDialog v-model="open" />
    </template>
  </div>
</template>
