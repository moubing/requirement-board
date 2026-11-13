<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { BingButton } from '@moubing/bing-ui'
import { Check, ChevronDown, Copy, Download } from 'lucide-vue-next'
import { useCopyFeedback } from '~/composables/use-copy-feedback'
import { useOperationFeedback } from '~/composables/use-operation-feedback'

const props = defineProps<{ userId: string; activeCount: number | null; busy: boolean }>()
defineEmits<{ create: [] }>()
const feedback = useOperationFeedback()
const { copied, markCopied, resetCopied } = useCopyFeedback()
const guideId = useId()
const guideOpen = ref(true)
const installCopied = ref(false)
const usageConfirmed = ref(false)
const notice = ref('')
const error = ref('')
const guideRoot = ref<HTMLElement | null>(null)
const complete = computed(() => (props.activeCount ?? 0) > 0 && installCopied.value && usageConfirmed.value)
const key = () => 'rb-agent-onboarding:' + props.userId
const baseUrl = useRequestURL().origin
const installUrl = baseUrl + '/api/agent/setup'
const skillActions = {
  install: { label: '安装', message: '请帮我在本机 Codex 安装并配置 文档看板 Skill，已有配置时直接复用；需要填写 Token 时打开独立终端，不要在聊天中索取凭证。' },
  update: { label: '更新', message: '请帮我更新本机 Codex 的 文档看板 Skill，保留并复用现有 URL 和 Token，无需先卸载，也不要让我重复填写凭证。' },
  uninstall: { label: '卸载', message: '请帮我卸载本机 Codex 的 文档看板 Skill，保留本机 URL、Token 和备份，方便以后重装；不要撤销网站凭证。' },
}
let disposed = false
function restore() {
  installCopied.value = false; usageConfirmed.value = false
  notice.value = ''; error.value = ''; resetCopied()
  try {
    const saved = JSON.parse(localStorage.getItem(key()) ?? 'null')
    if (saved?.version === 1) {
      installCopied.value = saved.installCopied === true
      usageConfirmed.value = saved.usageConfirmed === true
    }
  } catch { /* 损坏或不可用的本机存储不阻止配置。 */ }
  guideOpen.value = !complete.value
}
function save() {
  try { localStorage.setItem(key(), JSON.stringify({ version: 1, installCopied: installCopied.value, usageConfirmed: usageConfirmed.value })) }
  catch { notice.value = '进度仅保留在本页，刷新后需重新确认。' }
}
watch(complete, async value => {
  const hadFocus = guideRoot.value?.contains(document.activeElement)
  guideOpen.value = !value
  if (value && hadFocus) {
    await nextTick()
    guideRoot.value?.querySelector<HTMLButtonElement>('.agent-guide-toggle')?.focus()
  }
})
watch(() => props.userId, restore)
onMounted(restore)
onBeforeUnmount(() => { disposed = true })
function confirmUsage() {
  usageConfirmed.value = true
  notice.value = complete.value ? 'AI 协作已配置，可随时查看使用说明。' : '已记录首次调用。'
  save()
}
async function copySkillLink(action: keyof typeof skillActions) {
  error.value = ''; notice.value = ''
  const { label, message } = skillActions[action]
  const url = action === 'install' ? installUrl : installUrl + '?action=' + action
  const accountId = props.userId
  const operation = feedback.begin('正在复制 Skill ' + label + '说明')
  try {
    await navigator.clipboard.writeText(message + '\n请按照此链接的说明操作：\n' + url)
    if (disposed || accountId !== props.userId || !operation.isCurrent()) return
    markCopied(action)
    notice.value = label + '说明已复制，直接发给本机 Codex 即可'
    operation.success(notice.value)
    if (action === 'install') { installCopied.value = true; save() }
  } catch {
    if (disposed || accountId !== props.userId) return
    error.value = '复制失败，请手动复制' + label + '说明链接：' + url
    operation.error('Skill ' + label + '说明复制失败，请手动复制。')
  }
}
</script>

<template>
  <section ref="guideRoot" class="account-card agent-collaboration" aria-labelledby="agent-tokens-title">
    <div class="agent-heading"><h2 id="agent-tokens-title">AI 协作</h2><span class="account-hint">文档看板 Skill</span></div>
    <p class="agent-intro">让本机 AI 帮你整理、编写和更新文档。</p>
    <BingButton v-if="complete" variant="ghost" class="agent-guide-toggle" :aria-expanded="guideOpen" :aria-controls="guideId" @click="guideOpen = !guideOpen"><template #prefix><Check :size="16" aria-hidden="true" /></template>已配置，查看使用说明<template #suffix><ChevronDown :size="14" :class="{ 'is-open': guideOpen }" aria-hidden="true" /></template></BingButton>
    <div v-show="guideOpen" :id="guideId" class="agent-guide">
      <ol class="agent-setup" aria-label="AI 协作配置进度">
        <li :class="{ 'is-complete': (activeCount ?? 0) > 0 }"><span class="agent-step-number" aria-hidden="true"><Check v-if="(activeCount ?? 0) > 0" :size="16" /><template v-else>1</template></span><h3>创建访问凭证</h3><p>{{ activeCount === null ? '正在检查有效凭证…' : activeCount > 0 ? '已有有效凭证，可以继续安装。' : '为本机 Codex 创建凭证，权限跟随你的账号。' }}</p><BingButton v-if="activeCount === 0" variant="secondary" size="sm" :disabled="busy" @click="$emit('create')">创建访问凭证</BingButton></li>
        <li :class="{ 'is-complete': installCopied }"><span class="agent-step-number" aria-hidden="true"><Check v-if="installCopied" :size="16" /><template v-else>2</template></span><h3>{{ installCopied ? '安装说明已复制' : '安装到本机 Codex' }}</h3><p>将安装说明粘贴给 Codex，凭证只填写到安装终端中。</p></li>
        <li :class="{ 'is-complete': usageConfirmed }"><span class="agent-step-number" aria-hidden="true"><Check v-if="usageConfirmed" :size="16" /><template v-else>3</template></span><h3>开始文档协作</h3><p>调用 <code>$requirement-board</code>，附链接和要求。</p><BingButton v-if="!usageConfirmed" variant="ghost" size="sm" :disabled="!installCopied || !activeCount" @click="confirmUsage">我已完成调用</BingButton><span v-else class="agent-step-done">已确认完成</span></li>
      </ol>
      <p class="account-hint">调用后确认第 3 步，进度仅保存在本机。</p>
    </div>
    <div class="agent-skill-toolbar">
      <div class="agent-skill-actions"><BingButton v-for="(action, name) in skillActions" :key="name" variant="tertiary" size="sm" :aria-label="'复制' + action.label + '说明'" @click="copySkillLink(name)"><template #prefix><component :is="copied.includes(name) ? Check : Copy" :size="14" aria-hidden="true" /></template>{{ copied.includes(name) ? '已复制' : action.label + '说明' }}</BingButton></div>
      <div class="agent-guide-links"><a :href="installUrl" target="_blank" rel="noopener">安装说明</a><a href="/api/account/agent-skill" download><Download :size="14" aria-hidden="true" />下载 Skill</a></div>
    </div>
    <p v-if="guideOpen" class="account-hint">需要 Node.js 22+；更新复用凭证，卸载保留配置。</p>
    <p v-if="error" class="account-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.agent-collaboration { min-width: 0; padding: 16px; }
.agent-heading, .agent-skill-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.agent-heading h2 { font-size: 15px; font-weight: 650; }
.agent-intro { margin: 6px 0 10px; color: var(--bing-muted); font-size: 13px; }
.agent-setup { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 0; margin: 0 0 12px; list-style: none; }
.agent-setup li { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
.agent-step-number { display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 8px; border: 1px solid var(--bing-border); border-radius: 50%; color: var(--bing-muted); font-size: 12px; }
.is-complete .agent-step-number { background: var(--bing-success-soft); color: var(--bing-success-strong); border-color: transparent; }
.agent-setup h3 { margin: 0; font-size: 13px; }
.agent-setup p { flex: 1; margin: 2px 0 4px; font-size: 12px; color: var(--bing-muted); line-height: 1.6; overflow-wrap: anywhere; }
.agent-step-done { color: var(--bing-success-strong); font-size: 12px; min-height: 24px; display: inline-flex; align-items: center; }
.agent-guide-toggle { color: var(--ui-accent); margin-bottom: 12px; }
.agent-guide-toggle .is-open { transform: rotate(180deg); }
.agent-skill-toolbar { margin-top: 12px; }
.agent-collaboration > .account-hint, .agent-guide > .account-hint { margin: 10px 0 0; }
.agent-skill-actions, .agent-guide-links { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.agent-guide-links { gap: 16px; }
.agent-guide-links a { display: inline-flex; align-items: center; gap: 5px; color: var(--ui-accent); font-size: 12px; }
.agent-guide-links a:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 4px; }
@container account-sections (min-width: 980px) {
  .agent-setup { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .agent-setup li { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 10px; }
  .agent-step-number { grid-row: 1 / 4; margin: 0; }
  .agent-setup h3, .agent-setup p, .agent-step-done, .agent-setup li > button { grid-column: 2; justify-self: start; }
}
@media (max-width: 640px) {
  .agent-collaboration { padding: 16px; }
  .agent-setup { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .agent-setup li { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 12px; }
  .agent-step-number { grid-row: 1 / 4; margin: 0; }
  .agent-setup h3, .agent-setup p, .agent-step-done, .agent-setup li > button { grid-column: 2; justify-self: start; }
}
</style>
