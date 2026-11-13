<script setup lang="ts">
import { BingSelect, type BingSelectModelValue, type BingSelectOption } from '@moubing/bing-ui'

const value = defineModel<BingSelectModelValue>({ required: true })
defineProps<{ label: string; displayLabel?: string; inline?: boolean; options: BingSelectOption[] }>()

function optionDescription(option: BingSelectOption) {
  return [option.detail, ...Object.entries(option.meta ?? {}).map(([key, value]) => `${key}：${value}`)]
    .filter(Boolean).join('；')
}
</script>

<template>
  <label class="requirement-version-select" :class="{ 'requirement-version-select--inline': inline }">
    <span class="requirement-version-select__label">{{ displayLabel ?? label }}</span>
    <BingSelect v-model="value" :options="options" :size="inline ? 'sm' : 'md'" :clearable="false" :min-width="0" block :aria-label="label">
      <template #option="{ option }">
        <span class="requirement-version-select__option-label">{{ option.label }}</span>
        <span class="requirement-version-select__accessible-detail">{{ optionDescription(option) }}</span>
      </template>
      <template #option-detail="{ option }">
        <div class="requirement-version-detail">
          <dl v-if="option.meta" class="requirement-version-detail__metadata">
            <div v-for="(entry, key) in option.meta" :key="key"><dt>{{ key }}</dt><dd>{{ entry }}</dd></div>
          </dl>
          <p v-if="option.detail" class="requirement-version-detail__commit">{{ option.detail }}</p>
        </div>
      </template>
    </BingSelect>
  </label>
</template>

<style scoped>
.requirement-version-select { display: grid; gap: 6px; min-width: 0; }
.requirement-version-select--inline { grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; }
.requirement-version-select--inline .requirement-version-select__label { white-space: nowrap; }
.requirement-version-select__label { color: var(--bing-muted); font-size: 12px; }
.requirement-version-select__option-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.requirement-version-select__accessible-detail { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.requirement-version-detail { display: grid; gap: 8px; min-width: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.requirement-version-detail p, .requirement-version-detail dl, .requirement-version-detail dd { margin: 0; }
.requirement-version-detail dt { color: var(--bing-muted); }
.requirement-version-detail__metadata { display: grid; gap: 8px; }
.requirement-version-detail__metadata > div { display: grid; gap: 2px; }
.requirement-version-detail dt { font-size: 11px; }
.requirement-version-detail dd { color: var(--bing-heading); }
.requirement-version-detail__commit { white-space: pre-wrap; }
.requirement-version-detail__metadata + .requirement-version-detail__commit { padding-top: 8px; border-top: 1px solid var(--bing-border); }
</style>
