<script setup lang="ts">
import { BingDropDownItem } from '@moubing/bing-ui'
import type { CalloutTone } from '~~/shared/editor/callout'
import { calloutOptions } from './callout-presentation'

defineProps<{ current?: CalloutTone }>()
const emit = defineEmits<{ select: [tone: CalloutTone] }>()
</script>

<template>
  <BingDropDownItem v-for="option in calloutOptions" :key="option.tone" :title="option.label"
    :description="option.description" :icon="option.icon" type="radio" :checked="current === option.tone" @click="emit('select', option.tone)">
  </BingDropDownItem>
</template>
