<script setup lang="ts">
import AccountShell from '~/components/accounts/AccountShell.vue'
import RegistrationForm from '~/components/accounts/RegistrationForm.vue'
import { resolveAuthRedirect } from '~/utils/auth-redirect'
const route = useRoute()
useHead({ title: '注册 · 文档看板' })
</script>

<template>
  <AccountShell title="加入文档工作台" description="创建账号后，管理员会审批你的加入申请。" compact>
    <div class="account-card">
      <RegistrationForm @registered="navigateTo(resolveAuthRedirect(route.query.redirect, '/account'))" />
      <p class="account-hint account-centered">已有账号？<NuxtLink :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : {} }">去登录</NuxtLink></p>
    </div>
  </AccountShell>
</template>
