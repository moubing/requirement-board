<script setup lang="ts">
import { BingCheckbox } from '@moubing/bing-ui'

defineProps<{ checked: boolean; interactive?: boolean; label?: string }>()
defineEmits<{ toggle: [checked: boolean] }>()
</script>

<template>
  <component :is="interactive ? 'button' : 'span'" class="requirement-task-checkbox"
    :type="interactive ? 'button' : undefined" :role="interactive ? 'checkbox' : 'img'"
    :aria-checked="interactive ? checked : undefined"
    :aria-label="label || (checked ? '已勾选' : '未勾选')" contenteditable="false"
    @mousedown.prevent @click.stop="interactive && $emit('toggle', !checked)">
    <BingCheckbox decorative :model-value="checked" size="sm" />
  </component>
</template>
