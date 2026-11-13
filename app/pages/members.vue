<script setup lang="ts">
import { BingButton, BingCard, BingDialog, BingIcon, BingInput, BingTable } from '@moubing/bing-ui'
import type { BingTableColumn, BingTableRow } from '@moubing/bing-ui'
import { RefreshCw, Search, Users } from 'lucide-vue-next'
import type { ManagedUser, ProjectRole } from '#shared/auth/access'
import RolePicker from '~/components/accounts/RolePicker.vue'
import { accountError, roleText } from '~/utils/account-display'
import { useOperationFeedback } from '../composables/use-operation-feedback'
const feedback = useOperationFeedback()
const access = useAccountAccessState()
const requestFetch = useRequestFetch()
const { data, pending, error: loadError, refresh } = await useAsyncData('project-members', () => requestFetch<ManagedUser[]>('/api/members'))
const rows = computed(() => (data.value ?? []).map((row) => ({ ...row })))
const columns: BingTableColumn[] = [
  { key: 'name', title: '成员', minWidth: 260 },
  { key: 'roles', title: '项目角色', minWidth: 240 }, { key: 'actions', title: '操作', width: 130 },
]
const selected = ref<ManagedUser | null>(null)
const roles = ref<ProjectRole[]>([])
const open = ref(false)
const formId = useId()
const search = ref('')
const page = ref(1)
watch(search, () => { page.value = 1 })
const filteredRows = computed(() => rows.value.filter(row => `${row.name} ${row.email}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const busy = ref(false)
const error = ref('')
const notice = ref('')
const failedEdit = ref<{ user: ManagedUser; roles: ProjectRole[]; error: string } | null>(null)
function edit(row: BingTableRow) {
  selected.value = row as unknown as ManagedUser
  const previous = failedEdit.value?.user.id === selected.value.id ? failedEdit.value : null
  roles.value = [...(previous?.roles ?? selected.value.projectRoles)]; error.value = previous?.error ?? ''; open.value = true
}
async function save() {
  if (!selected.value || busy.value) return
  const target = selected.value
  const input = [...roles.value]
  if (JSON.stringify([...input].sort()) === JSON.stringify([...target.projectRoles].sort())) { error.value = '项目角色没有变化'; return }
  busy.value = true
  error.value = ''
  open.value = false
  const operation = feedback.begin(`正在保存 ${target.name} 的项目角色`)
  try {
    await $fetch(`/api/members/${target.id}/roles`, { method: 'PUT', body: { roles: input }, retry: 0, timeout: 15_000 })
    operation.success(`${target.name} 的项目角色已更新`)
    if (!operation.isCurrent()) return
    failedEdit.value = null
    notice.value = `${target.name} 的项目角色已更新`
    void operation.refresh(() => refresh(), () => loadError.value)
  } catch (err) {
    const message = accountError(err)
    operation.error(`${target.name} 的角色保存失败：${message}，选择已保留。`)
    if (operation.isCurrent()) { failedEdit.value = { user: target, roles: input, error: message }; if (selected.value?.id === target.id) error.value = message }
  }
  finally { busy.value = false }
}
useHead({ title: '项目成员 · 文档看板' })
</script>

<template>
  <main class="workspace-page members-page">
    <div class="workspace-content">
      <BingCard class="members-list-card" variant="plain" padding="none" rounded="md"
        :glass="false" :interactive="false" :tilt="false" :glare="false" entrance="none" flip-trigger="none">
        <div class="members-list-controls">
          <header class="members-list-toolbar">
            <h1><BingIcon :icon="Users" :size="18" decorative />项目成员</h1>
            <div class="members-list-actions">
              <span class="workspace-count" aria-live="polite">共 <strong>{{ filteredRows.length }}</strong> 位成员</span>
              <BingButton variant="tertiary" :loading="pending" @click="refresh()"><span class="members-action-label"><BingIcon :icon="RefreshCw" :size="16" decorative />刷新</span></BingButton>
            </div>
          </header>
          <BingInput v-model="search" :icon="Search" placeholder="搜索成员姓名或邮箱" aria-label="搜索成员" clearable block />
          <p v-if="loadError" class="account-error" role="alert">{{ accountError(loadError) }}</p>
          <p v-if="notice" class="account-success" role="status">{{ notice }}</p>
          <p v-if="failedEdit" class="account-error" role="alert">{{ failedEdit.user.name }} 的角色尚未保存：{{ failedEdit.error }}<BingButton size="sm" variant="ghost" @click="edit(failedEdit.user as unknown as BingTableRow)">继续设置角色</BingButton></p>
        </div>
        <div class="members-list-results">
          <BingTable v-model:page="page" class="members-table" :data="filteredRows" :columns="columns" :loading="pending"
            row-key="id" :striped="false" :bordered="false" pagination :default-page-size="10" :page-size-options="[10, 20, 50]"
            :show-column-controls="false" :preserve-page-height="false" empty-text="暂无符合条件的项目成员" aria-label="项目成员">
            <template #cell-name="{ row }"><div class="account-cell-identity"><strong>{{ row.name }}</strong><small>{{ row.email }}<span v-if="row.banned">（已停用）</span></small></div></template>
            <template #cell-roles="{ row }">{{ roleText(row.projectRoles as ProjectRole[]) }}</template>
            <template #cell-actions="{ row }"><BingButton size="sm" variant="ghost" @click="edit(row)"><span class="members-role-action">设置角色</span></BingButton></template>
          </BingTable>
        </div>
      </BingCard>
    <BingDialog :busy="busy" v-model="open" title="设置项目角色" :width="530" :close-on-overlay="false">
      <form :id="formId" class="account-form" @submit.prevent="save">
        <strong>{{ selected?.name }} · {{ selected?.email }}</strong>
        <RolePicker v-model="roles" :disabled="busy" :allow-project-admin="access?.user.role === 'admin'" />
        <p v-if="access?.user.role !== 'admin'" class="account-hint">项目管理员资格由超级管理员调整。</p>
        <p v-if="error" class="account-error" role="alert">{{ error }}</p>
      </form>
      <template #footer><BingButton variant="secondary" :disabled="busy" @click="open = false">取消</BingButton><BingButton html-type="submit" :form="formId" :loading="busy">保存角色</BingButton></template>
    </BingDialog>
    </div>
  </main>
</template>
