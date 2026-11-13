<script setup lang="ts">
import { BingButton, BingDialog, BingForm, BingFormItem, BingInput } from '@moubing/bing-ui'
import type { BingFormExpose, BingFormSubmitPayload } from '@moubing/bing-ui'
import { changePasswordSchema } from '#shared/auth/account-input'
import { authClient } from '~/lib/auth-client'
import { computed } from 'vue'
import { passwordStrength } from '~/utils/account-password'

defineOptions({ inheritAttrs: false })
const open = defineModel<boolean>({ default: false })
const form = reactive({ currentPassword: '', newPassword: '', confirmation: '' })
const passwordForm = ref<BingFormExpose | null>(null)
const formId = useId()
const busy = ref(false)
const error = ref('')
const success = ref(false)
const strength = computed(() => passwordStrength(form.newPassword))
watch(() => [form.newPassword, form.confirmation], () => {
  if (form.confirmation) void passwordForm.value?.validateField('confirmation')
})
watch(open, () => {
  Object.assign(form, { currentPassword: '', newPassword: '', confirmation: '' })
  error.value = ''
  success.value = false
  passwordForm.value?.clearValidate()
})

async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value) return
  error.value = ''
  busy.value = true
  try {
    const input = changePasswordSchema.parse(form)
    const result = await authClient.changePassword({ currentPassword: input.currentPassword, newPassword: input.newPassword, revokeOtherSessions: true })
    if (result.error) {
      error.value = result.error.code === 'INVALID_PASSWORD' ? '当前密码不正确，请重新输入'
        : result.error.status === 401 ? '登录已失效，请重新登录'
          : result.error.status === 429 ? '操作过于频繁，请稍后再试' : '修改密码失败，请稍后重试'
      return
    }
    Object.assign(form, { currentPassword: '', newPassword: '', confirmation: '' })
    success.value = true
  } catch { error.value = '修改密码失败，请稍后重试' }
  finally { busy.value = false }
}
</script>

<template>
  <BingDialog :busy="busy" v-model="open" title="修改密码" :width="480" :height="480" :max-width="480" :max-height="480" :show-peek="false" :close-on-overlay="false">
    <div v-if="success" class="account-stack">
      <p class="account-success" role="status">密码已修改。当前登录已保留，其他设备需要使用新密码重新登录。</p>
    </div>
    <BingForm v-else :id="formId" ref="passwordForm" :model="form" :schema="changePasswordSchema" layout="stack" :disabled="busy" @submit="submit">
      <BingFormItem prop="currentPassword" label="当前密码" required><BingInput v-model="form.currentPassword" type="password" autocomplete="current-password" block /></BingFormItem>
      <BingFormItem prop="newPassword" label="新密码" required><BingInput v-model="form.newPassword" type="password" autocomplete="new-password" placeholder="6–128 个字符" block /></BingFormItem>
      <div v-if="form.newPassword" class="account-password-strength" :data-level="strength.level" role="status">
        <div class="account-password-meter" aria-hidden="true"><i v-for="n in 3" :key="n" :class="{ filled: n <= strength.level }" /></div>
        <span>密码强度：{{ strength.label }}</span><small>{{ strength.hint }}</small>
      </div>
      <BingFormItem prop="confirmation" label="确认新密码" required><BingInput v-model="form.confirmation" type="password" autocomplete="new-password" block /></BingFormItem>
      <p v-if="form.confirmation && form.confirmation === form.newPassword" class="account-success" role="status">两次输入一致</p>
      <p class="account-hint">修改后保留当前登录，其他设备需要重新登录。</p>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    </BingForm>
    <template #footer>
      <BingButton v-if="success" @click="open = false">完成</BingButton>
      <template v-else><BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton><BingButton html-type="submit" :form="formId" :loading="busy">保存新密码</BingButton></template>
    </template>
  </BingDialog>
</template>
