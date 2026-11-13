<script setup lang="ts">
import { BingButton, BingForm, BingFormItem, BingInput } from '@moubing/bing-ui'
import type { BingFormSubmitPayload } from '@moubing/bing-ui'
import { registrationSchema } from '#shared/auth/account-input'
import type { AccountAccess } from '#shared/auth/access'
import { authClient } from '~/lib/auth-client'

const props = withDefaults(defineProps<{ email?: string; name?: string; invited?: boolean }>(), { email: '', name: '' })
const emit = defineEmits<{ registered: [] }>()
const form = reactive({ name: props.name, username: '', email: props.email, password: '', confirmation: '' })
const busy = ref(false)
const error = ref('')
const access = useAccountAccessState()
const session = useAuthSessionState()

async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value) return
  error.value = ''
  busy.value = true
  try {
    const { confirmation: _confirmation, ...input } = registrationSchema.parse(form)
    const result = await authClient.signUp.email(input)
    if (result.error) {
      const code = String(result.error.code)
      error.value = result.error.status === 429 ? '注册过于频繁，请稍后再试'
        : code.includes('USERNAME') ? '用户名不可用，请使用 3–30 位字母、数字、下划线或点，并尝试其他名称'
          : code.includes('USER_ALREADY_EXISTS') ? '这个邮箱已注册，请登录已有账号'
            : code.includes('PASSWORD') ? '密码需要 6–128 个字符'
              : '注册失败，请检查填写内容后重试'
      return
    }
    // 账号已成功创建；后续网络失败时由页面刷新恢复，避免重复提交注册。
    try {
      access.value = await $fetch<AccountAccess>('/api/account/access')
      session.value = { user: access.value.user }
    } catch {
      await navigateTo(props.invited ? '/invite' : '/account', { external: true })
      return
    }
    emit('registered')
  } catch {
    error.value = '暂时无法注册，请稍后重试'
  } finally { busy.value = false }
}
</script>

<template>
  <BingForm method="post" :model="form" :schema="registrationSchema" layout="stack" :disabled="busy" @submit="submit">
    <BingFormItem prop="name" label="姓名" required><BingInput v-model="form.name" autocomplete="name" placeholder="同事们如何称呼你" maxlength="80" block /></BingFormItem>
    <BingFormItem prop="username" label="用户名" required><BingInput v-model="form.username" autocomplete="username" placeholder="3–30 位字母、数字、下划线或点" maxlength="30" block /></BingFormItem>
    <BingFormItem prop="email" label="邮箱" required><BingInput v-model="form.email" type="email" autocomplete="email" placeholder="name@example.com" maxlength="160" block :disabled="busy || invited" /></BingFormItem>
    <BingFormItem prop="password" label="密码" required><BingInput v-model="form.password" type="password" autocomplete="new-password" placeholder="6–128 个字符" maxlength="128" block /></BingFormItem>
    <BingFormItem prop="confirmation" label="确认密码" required><BingInput v-model="form.confirmation" type="password" autocomplete="new-password" placeholder="再次输入密码" block /></BingFormItem>
    <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    <BingButton html-type="submit" :loading="busy" block>{{ invited ? '注册并接受邀请' : '注册并申请加入' }}</BingButton>
  </BingForm>
</template>
