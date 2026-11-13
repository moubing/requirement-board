<script setup lang="ts">
import { BingInput, type BingInputValue } from '@moubing/bing-ui'

const props = withDefaults(defineProps<{
  modelValue: number | null
  label: string
  min: number
  max: number
  step?: number
  placeholder?: string
}>(), { step: 1, placeholder: '默认' })
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
function input(value: BingInputValue) {
  if (value === null) emit('update:modelValue', null)
  else if (typeof value === 'number' && Number.isFinite(value) && value >= props.min && value <= props.max) {
    emit('update:modelValue', value)
  }
}
</script>

<template>
  <BingInput :model-value="modelValue" type="number" :min="min" :max="max" :step="step"
    :placeholder="placeholder" :aria-label="label" block @update:model-value="input" />
</template>
