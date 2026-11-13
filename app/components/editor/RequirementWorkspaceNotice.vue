<script lang="ts">
export interface WorkspaceNotice {
  id: string
  tone: 'info' | 'error'
  title: string
  message: string
  action?: string
  dismissible?: boolean
}
</script>

<script setup lang="ts">
import { CircleAlert, Info, X } from 'lucide-vue-next'
import { BingButton, BingIcon } from '@moubing/bing-ui'

defineProps<{ notices: WorkspaceNotice[] }>()
defineEmits<{ action: [id: string]; dismiss: [id: string] }>()
</script>

<template>
  <section v-if="notices.length" class="workspace-notices" aria-label="工作区提示">
    <div v-for="notice in notices" :key="notice.id" class="workspace-notice" :class="`workspace-notice--${notice.tone}`" :role="notice.tone === 'error' ? 'alert' : 'status'">
      <header>
        <BingIcon :icon="notice.tone === 'error' ? CircleAlert : Info" :size="16" decorative />
        <strong>{{ notice.title }}</strong>
        <BingButton v-if="notice.dismissible" size="xs" variant="ghost" aria-label="关闭操作提示" @click="$emit('dismiss', notice.id)"><BingIcon :icon="X" :size="14" decorative /></BingButton>
      </header>
      <p>{{ notice.message }}</p>
      <BingButton v-if="notice.action" size="sm" variant="secondary" @click="$emit('action', notice.id)">{{ notice.action }}</BingButton>
    </div>
  </section>
</template>

<style scoped>
.workspace-notices { display: grid; gap: 10px; min-width: 0; }
.workspace-notice { padding: 12px 14px; border: 1px solid var(--bing-border); border-radius: 8px; color: var(--bing-muted); background: var(--bing-surface-muted); }
.workspace-notice--error { border-color: rgb(var(--bing-danger-rgb) / .22); background: var(--bing-danger-soft); }
.workspace-notice header { display: flex; align-items: center; gap: 8px; color: var(--bing-heading); }
.workspace-notice--error header { color: var(--bing-danger-strong); }
.workspace-notice strong { flex: 1; font-size: 12px; }
.workspace-notice p { margin: 8px 0 0; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.workspace-notice > .bing-button { margin-top: 10px; max-width: 100%; height: auto; white-space: normal; }
</style>
