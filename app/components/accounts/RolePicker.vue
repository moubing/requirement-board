<script setup lang="ts">
import { BingCheckbox } from '@moubing/bing-ui'
import { PROJECT_ROLES, PROJECT_ROLE_LABELS } from '#shared/auth/access'
import type { ProjectRole } from '#shared/auth/access'

const props = withDefaults(defineProps<{ modelValue: ProjectRole[]; disabled?: boolean; allowProjectAdmin?: boolean }>(), { allowProjectAdmin: true })
const emit = defineEmits<{ 'update:modelValue': [roles: ProjectRole[]] }>()
function toggle(role: ProjectRole, checked: boolean) {
  emit('update:modelValue', checked ? [...new Set([...props.modelValue, role])] : props.modelValue.filter((item) => item !== role))
}
</script>

<template>
  <fieldset class="account-role-picker" :disabled="disabled">
    <legend>项目角色（可多选）</legend>
    <div class="account-role-options">
      <BingCheckbox v-for="role in PROJECT_ROLES" :key="role"
        :model-value="modelValue.includes(role)" :label="PROJECT_ROLE_LABELS[role]"
        :disabled="disabled || (role === 'project_admin' && !allowProjectAdmin)"
        @update:model-value="toggle(role, $event)" />
    </div>
    <p class="account-hint">可同时担任多个角色；不选角色也可以作为普通成员参与文档编辑。</p>
  </fieldset>
</template>
