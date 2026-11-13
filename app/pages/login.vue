<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId } from 'vue'
import { z } from 'zod'
import { Check, Eye, EyeOff, LockKeyhole, LogIn, UserRound } from 'lucide-vue-next'
import {
  BingButton,
  BingCheckbox,
  BingIcon,
  BingInput,
  BingForm,
  BingFormItem,
  bingToast,
} from '@moubing/bing-ui'
import type { BingFormSubmitPayload, BingInputExpose, BingInputValue } from '@moubing/bing-ui'

import LoginBrand from '~/components/accounts/LoginBrand.vue'
import { authClient } from '~/lib/auth-client'
import { resolveAuthRedirect } from '~/utils/auth-redirect'

const route = useRoute()
const form = reactive({
  account: '',
  password: '',
  rememberMe: true,
})
const submitting = ref(false)
const succeeded = ref(false)
const formError = ref('')
const errorToastId = `login-error-${useId()}`
const focusedField = ref<'account' | 'password' | null>(null)
const showPassword = ref(false)
const capsLock = ref(false)
const passwordInput = ref<BingInputExpose | null>(null)
const busy = computed(() => submitting.value || succeeded.value)
const previewState = computed(() => {
  if (succeeded.value) return 'success'
  if (submitting.value) return 'submitting'
  if (formError.value) return 'error'
  return 'idle'
})
const passwordDescription = computed(() => [formError.value && 'login-error', capsLock.value && focusedField.value === 'password' && 'login-caps-lock'].filter(Boolean).join(' ') || undefined)
const schema = z.object({ account: z.string().trim().min(1, '请输入账号或邮箱'), password: z.string().min(1, '请输入密码'), rememberMe: z.boolean() })
let disposed = false
let successTimer: ReturnType<typeof setTimeout> | undefined
let finishSuccess: (() => void) | undefined

onBeforeUnmount(() => {
  disposed = true
  bingToast.close(errorToastId)
  clearTimeout(successTimer)
  finishSuccess?.()
})

useHead({ title: '登录 · 文档看板' })

function updateField(field: 'account' | 'password', value: BingInputValue) {
  form[field] = String(value ?? '')
  clearLoginError()
}

function clearLoginError() {
  formError.value = ''
  bingToast.close(errorToastId)
}

function showLoginError(message: string) {
  formError.value = message
  bingToast.error({ id: errorToastId, message, position: 'top-center', duration: 6000, ariaLabel: '登录失败' })
}

function focusPassword(_value: BingInputValue, event: KeyboardEvent) {
  event.preventDefault()
  passwordInput.value?.focus()
}

function updateCapsLock(event: KeyboardEvent | MouseEvent) { capsLock.value = event.getModifierState('CapsLock') }

function blurPassword(event: FocusEvent) {
  if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
  focusedField.value = null
  capsLock.value = false
}

async function togglePassword() {
  if (busy.value) return
  // 使用公开 input 引用保存选区，不读取组件内部 DOM。
  const input = passwordInput.value?.input
  const selection = input ? [input.selectionStart, input.selectionEnd, input.selectionDirection] as const : null
  const scrollLeft = input?.scrollLeft ?? 0
  showPassword.value = !showPassword.value
  await nextTick()
  if (disposed) return
  const field = passwordInput.value?.input
  if (!field) return
  // Chromium 切换密码类型后会在布局阶段重建选区，先完成布局再恢复。
  field.getBoundingClientRect()
  field.focus({ preventScroll: true })
  if (selection && selection[0] !== null && selection[1] !== null) field.setSelectionRange(selection[0], selection[1], selection[2] ?? undefined)
  field.scrollLeft = scrollLeft
}

async function submit({ valid }: BingFormSubmitPayload) {
  if (!valid || busy.value) return
  const parsed = schema.safeParse(form)
  if (!parsed.success) return
  clearLoginError()

  const account = parsed.data.account

  submitting.value = true
  try {
    const credentials = {
      password: parsed.data.password,
      rememberMe: parsed.data.rememberMe,
    }
    const result = account.includes('@')
      ? await authClient.signIn.email({ ...credentials, email: account })
      : await authClient.signIn.username({ ...credentials, username: account })

    if (disposed) return
    if (result.error) {
      if (result.error.status === 429) {
        showLoginError('尝试次数过多，请稍后再试')
      } else if (result.error.status === 403) {
        showLoginError('账号已停用，请联系管理员')
      } else if (
        result.error.status === 400
        || result.error.status === 401
        || result.error.status === 422
      ) {
        showLoginError('账号或密码不正确')
      } else {
        showLoginError('暂时无法登录，请稍后重试')
      }
      return
    }

    succeeded.value = true
    await nextTick()
    if (disposed) return
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await new Promise<void>((resolve) => { finishSuccess = resolve; successTimer = setTimeout(resolve, 420) })
      finishSuccess = undefined
    }
    if (disposed) return
    await navigateTo(resolveAuthRedirect(route.query.redirect))
  } catch {
    if (disposed) return
    succeeded.value = false
    showLoginError('暂时无法登录，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page" @keydown.capture="updateCapsLock" @keyup.capture="updateCapsLock" @pointerdown.capture="updateCapsLock">
    <div class="login-layout">
      <LoginBrand :state="previewState" />
      <div class="login-card-entrance">
        <section class="login-card" :class="{ 'login-card--error': formError }" aria-labelledby="login-title">
          <div class="login-card__brand">
            <img class="login-card__logo" src="/requirement-board-logo.png" alt="文档看板" width="64" height="64" decoding="async">
            <div>
              <h1 id="login-title">欢迎回来</h1>
              <p>登录文档工作台<span class="login-card__welcome">，继续一起创造。</span></p>
            </div>
          </div>

          <BingForm class="login-form" method="post" :model="form" :schema="schema" layout="stack" size="lg" :gap="16" :disabled="busy" :aria-busy="submitting" @submit="submit">
            <BingFormItem prop="account" label="账号或邮箱" required class="login-field">
              <BingInput
                id="login-account"
                :model-value="form.account"
                name="account"
                type="text"
                autocomplete="username"
                autocapitalize="none"
                :spellcheck="false"
                placeholder="用户名或邮箱地址"
                :icon="UserRound"
                block
                :disabled="busy"
                :status="formError ? 'error' : undefined"
                :aria-describedby="formError ? 'login-error' : undefined"
                @update:model-value="updateField('account', $event)"
                @focus="focusedField = 'account'"
                @blur="focusedField = null"
                @enter="focusPassword"
              />
            </BingFormItem>

            <BingFormItem prop="password" label="密码" required class="login-field" @focusin="focusedField = 'password'" @focusout="blurPassword">
              <BingInput
                id="login-password"
                ref="passwordInput"
                :model-value="form.password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                :password-toggle="false"
                :smooth-caret="false"
                autocomplete="current-password"
                placeholder="请输入密码"
                :icon="LockKeyhole"
                block
                :disabled="busy"
                :status="formError ? 'error' : undefined"
                :aria-describedby="passwordDescription"
                @update:model-value="updateField('password', $event)"
              >
                <template #suffix>
                  <BingButton variant="ghost" size="xs" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" aria-controls="login-password" :disabled="busy" @pointerdown.prevent @click.stop="togglePassword">
                    <BingIcon :icon="showPassword ? EyeOff : Eye" :size="17" decorative />
                  </BingButton>
                </template>
              </BingInput>
              <p v-if="capsLock && focusedField === 'password'" id="login-caps-lock" class="login-form__caps-lock" role="status">大写锁定已开启</p>
            </BingFormItem>

            <div class="login-form__options">
              <BingCheckbox v-model="form.rememberMe" label="保持登录" name="remember-me" size="sm" />
              <NuxtLink class="login-register" :to="{ path: '/register', query: route.query.redirect ? { redirect: route.query.redirect } : {} }">注册账号</NuxtLink>
            </div>

            <BingButton html-type="submit" block rounded="md" size="xl" :variant="succeeded ? 'success' : 'primary'" :loading="submitting && !succeeded" :disabled="busy" text-effect="none">
              <template #prefix>
                <BingIcon :icon="succeeded ? Check : LogIn" :size="17" decorative />
              </template>
              {{ succeeded ? '登录成功' : submitting ? '登录中…' : '登录' }}
            </BingButton>
          </BingForm>
          <p v-if="formError" id="login-error" class="visually-hidden">{{ formError }}</p>
          <p v-else-if="succeeded" class="visually-hidden" role="status">登录成功，正在进入工作台…</p>
          <p class="login-card__footer"><NuxtLink to="/demo" :prefetch="false" class="login-register">无需注册，体验示例文档</NuxtLink></p>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: calc(100dvh - var(--app-header-height));
  place-items: center;
  padding: 36px 44px;
  background-color: var(--bing-canvas);
  background-image:
    radial-gradient(ellipse at 12% 32%, color-mix(in srgb, var(--bing-purple-300) 9%, transparent), transparent 55%),
    linear-gradient(color-mix(in srgb, var(--rb-border) 22%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--rb-border) 22%, transparent) 1px, transparent 1px);
  background-size: auto, 36px 36px, 36px 36px;
}

.login-layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 55fr) minmax(0, 45fr);
  align-items: center;
  width: min(100%, 1120px);
  gap: 40px;
}

.login-layout > :first-child { animation: login-enter 420ms ease-out both; }
.login-card-entrance { min-width: 0; animation: login-enter 440ms 100ms ease-out both; }
.login-card--error { animation: login-shake 280ms ease-in-out; }

.login-form .login-field {
  --bing-form-item-message-min-height: 0px;
}

.login-field :deep(.bing-form-item__label) { transition: color 180ms ease-out; }
.login-field:focus-within :deep(.bing-form-item__label) { color: var(--ui-accent); }

@keyframes login-enter { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes login-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes login-shake { 25%, 75% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }

.login-register { position: relative; padding-block: 5px; color: var(--rb-ink); }
.login-register::after { content: ''; position: absolute; left: 0; right: 0; bottom: 1px; height: 1px; background: currentColor; transform: scaleX(0); transform-origin: left; transition: transform 180ms; }
.login-register:is(:hover, :focus-visible)::after { transform: scaleX(1); }
.login-register:focus-visible { outline: 2px solid var(--bing-focus-ring); outline-offset: 4px; border-radius: 2px; }

.login-form__caps-lock { margin: 6px 0 0; color: var(--rb-ink); font-size: 12px; line-height: 18px; }
.login-card__footer { margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--rb-border); color: var(--rb-muted); text-align: center; font-size: 11px; line-height: 1.6; }

@media (prefers-reduced-motion: reduce) {
  .login-layout > :first-child, .login-card-entrance { animation: login-fade 150ms both; }
  .login-card--error { animation: none; }
  .login-register::after { transition: none; }
}

.login-card {
  width: 100%;
  padding: 32px;
  border: 1px solid var(--rb-border);
  border-radius: 18px;
  background: var(--rb-panel);
  box-shadow: 0 18px 60px rgb(0 0 0 / .035);
}

.login-card__brand {
  margin-bottom: 24px;
}
.login-card__logo { display: none; flex: none; object-fit: contain; }

.login-card__brand p {
  margin: 12px 0 0;
  color: var(--rb-muted);
  font-size: 12px;
  line-height: 1.8;
}

.login-card__brand h1 {
  margin: 0;
  color: var(--rb-navy);
  font-size: 28px;
  line-height: 1.4;
  letter-spacing: -.03em;
}

.login-form__options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
  color: var(--rb-muted);
  font-size: 12px;
}

@media (min-width: 768px) and (max-width: 1023px) {
  .login-layout { grid-template-columns: 1fr; max-width: 580px; gap: 24px; }
  .login-card { padding: 32px 48px; }
}
@media (max-width: 767px) {
  .login-page { align-items: start; padding: 24px 16px; }
  .login-layout { display: block; max-width: 440px; }
  .login-card { padding: 28px 24px 22px; border-radius: 14px; }
  .login-card__brand { display: flex; align-items: center; gap: 14px; min-height: 64px; margin: 0 0 22px; }
  .login-card__logo { display: block; width: 64px; height: 64px; }
  .login-card__brand h1 { font-size: 24px; }
  .login-card__brand p { margin-top: 6px; font-size: 11px; }
  .login-card__welcome { display: none; }
  .login-card__footer { margin-top: 20px; padding-top: 18px; }
}
@media (max-width: 359px) {
  .login-page { padding-inline: 12px; }
  .login-card { padding-inline: 20px; }
  .login-card__brand { gap: 10px; }
  .login-card__logo { width: 52px; height: 52px; }
  .login-card__brand p { max-width: 135px; }
}
</style>
