<script setup lang="ts">
import { computed } from 'vue'
import { BingTag } from '@moubing/bing-ui'
import type { NodeAttribution } from '#shared/collaboration/attribution'

const props = defineProps<{
  node?: NodeAttribution
  changed: boolean
  pending?: boolean
  inline?: boolean
}>()
const visible = computed(() => props.changed || props.node?.authors.length || props.node?.unknown)
const note = computed(() => {
  if (props.pending) return '待同步确认'
  if (props.node?.unknown) return props.node.authors.length ? '部分修改人未记录' : '修改人未记录'
  return props.changed && !props.node?.authors.length ? '修改人未记录' : ''
})
</script>

<template>
  <div v-if="visible" class="diff-node-contributors" :class="{ 'diff-node-contributors--inline': inline }" aria-label="本版节点修改人">
    <span class="diff-node-contributors__label" title="该节点自上个正式版本以来的全部修改人，包含选区之外的修改">本版修改人</span>
    <div v-if="node?.authors.length" class="diff-node-contributors__names">
      <BingTag v-for="author in node.authors" :key="author.userId" size="sm" variant="soft" tone="primary" :title="author.name">
        <span class="diff-node-contributors__name">{{ author.name }}</span>
      </BingTag>
    </div>
    <span v-if="note" class="diff-node-contributors__note">{{ note }}</span>
  </div>
</template>

<style scoped>
.diff-node-contributors { display: grid; justify-items: center; gap: 5px; max-width: 100%; min-width: 0; padding: 2px 8px; font-weight: 400; }
.diff-node-contributors__label, .diff-node-contributors__note { color: var(--rb-muted); font-size: 11px; line-height: 1.5; text-align: center; }
.diff-node-contributors__names { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 100%; min-width: 0; }
.diff-node-contributors__names > * { max-width: 100%; }
.diff-node-contributors__name { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
.diff-node-contributors--inline { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 6px 10px; padding: 8px 16px 4px 44px; }
.diff-node-contributors--inline .diff-node-contributors__names { justify-content: flex-start; }
</style>
