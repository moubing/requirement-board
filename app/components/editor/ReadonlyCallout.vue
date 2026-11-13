<script setup lang="ts">
import { computed } from 'vue'
import { displayCalloutTone, calloutToneDetails } from '~~/shared/editor/callout'
import { calloutIcons } from './callout-presentation'

const props = defineProps<{ tone?: unknown }>()
const tone = computed(() => displayCalloutTone(props.tone))
</script>

<template>
  <section class="requirement-callout" :data-tone="tone" :aria-label="calloutToneDetails[tone].label">
    <span class="requirement-callout__icon" aria-hidden="true"><component :is="calloutIcons[tone]" :size="18" /></span>
    <div class="requirement-callout__content"><slot /></div>
  </section>
</template>
