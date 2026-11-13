<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LockKeyhole } from 'lucide-vue-next'
import { BingButton, BingIcon } from '@moubing/bing-ui'
import type { AgentLockDto } from '#shared/agent/lock'

const props = defineProps<{ lock: AgentLockDto; canRelease: boolean; busy: boolean; error: string }>()
const emit = defineEmits<{ release: [] }>()
const confirming = ref(false)
watch(() => props.lock.snapshotId, () => { confirming.value = false })
const expiry = computed(() => new Date(props.lock.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
</script>

<template>
  <section class="agent-lock-notice" aria-label="AI 编辑锁定" role="status">
    <div class="agent-lock-notice__body">
      <div class="agent-lock-notice__heading"><BingIcon :icon="LockKeyhole" :size="16" decorative /><strong>AI 正在编辑</strong><span class="agent-lock-notice__badge">只读</span></div>
      <p>{{ lock.userName }} 发起，当前文档暂为只读。</p>
      <p class="agent-lock-notice__hint">完成后恢复编辑；未续锁时将在 {{ expiry }} 自动解锁。</p>
      <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      <p v-if="confirming" class="agent-lock-notice__hint">取消后本轮尚未执行的操作将停止，AI 需要重新读取草稿。</p>
    </div>
    <div class="agent-lock-notice__actions">
      <template v-if="canRelease">
        <template v-if="confirming">
          <BingButton size="sm" variant="danger" :loading="busy" aria-label="确认取消 AI 编辑" @click="emit('release')">确认取消</BingButton>
          <BingButton size="sm" variant="ghost" :disabled="busy" @click="confirming = false">继续等待</BingButton>
        </template>
        <BingButton v-else size="sm" variant="secondary" @click="confirming = true">取消 AI 编辑</BingButton>
      </template>
    </div>
  </section>
</template>

<style scoped>
.agent-lock-notice { display: grid; gap: 12px; padding: 12px; border-left: 3px solid var(--bing-heading); border-radius: 6px; background: var(--bing-surface-soft); }
.agent-lock-notice__body { min-width: 0; }
.agent-lock-notice__heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--bing-heading); font-size: 13px; }
.agent-lock-notice__badge { padding: 2px 8px; border: 1px solid var(--rb-border); border-radius: 5px; font-size: 11px; color: var(--rb-muted); }
.agent-lock-notice p { margin: 6px 0 0; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.agent-lock-notice__hint { color: var(--rb-muted); font-size: 12px !important; }
.agent-lock-notice__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
</style>
