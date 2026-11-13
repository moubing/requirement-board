<script setup lang="ts">
import { BingButton } from '@moubing/bing-ui'
import RequirementDocumentLoading from '../editor/RequirementDocumentLoading.vue'
import RequirementEditorToolbarControls from '../editor/RequirementEditorToolbarControls.vue'
import RequirementWorkspaceNav from '../editor/RequirementWorkspaceNav.vue'

defineProps<{ pending: boolean; error?: string; requirementKey: string; view: 'edit' | 'diff' }>()
const emit = defineEmits<{ retry: [] }>()
const views = [{ value: 'edit', label: '正文' }, { value: 'diff', label: '版本比较' }]
</script>

<template>
  <main class="requirement-page requirement-page--opening" aria-label="文档详情" :aria-busy="pending">
    <header class="requirement-topbar">
      <RequirementWorkspaceNav :model-value="view" :requirement-key="requirementKey" :items="views" compact pending />
    </header>
    <div v-if="view === 'edit'" class="requirement-editor__toolbar" aria-label="编辑器工具栏">
      <RequirementEditorToolbarControls disabled annotations />
    </div>
    <div class="requirement-page__views">
      <div v-if="error" class="requirement-detail-error" role="alert">
        <p>{{ error }}</p>
        <BingButton variant="secondary" :throttle="false" :loading="pending" @click="emit('retry')">重新加载文档</BingButton>
      </div>
      <RequirementDocumentLoading v-else :pending="pending" />
    </div>
  </main>
</template>

<style scoped>
.requirement-editor__toolbar { flex-shrink: 0; }
.requirement-detail-error { padding: 32px 24px; text-align: center; }
.requirement-detail-error p { margin: 0 0 16px; color: var(--bing-muted); }
</style>
