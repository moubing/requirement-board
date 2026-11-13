<script setup lang="ts">
import { computed, onMounted, onServerPrefetch, watch } from 'vue'
import { BingButton } from '@moubing/bing-ui'
import type { BingTablePageChangePayload, BingTableSortPayload } from '@moubing/bing-ui'
import type { RequirementFilters, RequirementSortKey } from '#shared/requirements/query'
import type { RequirementColumnPreferences } from '~/utils/requirement-columns'
import { usePagedRequirements } from '~/composables/use-paged-requirements'
import { requirementQueryKey } from '~/composables/use-requirement-query'
import RequirementTable from './RequirementTable.vue'

const props = withDefaults(defineProps<{ queryKey: string; filters: RequirementFilters; compact?: boolean; enabled?: boolean;
  columnsState: RequirementColumnPreferences; showColumnControls?: boolean; label?: string; emptyText?: string }>(),
{ compact: false, enabled: true, showColumnControls: true, label: '文档列表', emptyText: '没有匹配的文档' })
const emit = defineEmits<{ 'update:columnsState': [value: RequirementColumnPreferences]; total: [value: number] }>()
const table = usePagedRequirements(props.queryKey, { ...props.filters, page: 1, pageSize: props.compact ? 5 : 10 }, () => props.enabled)
function load() {
  const previous = table.targetQuery.value
  const { page: _page, pageSize: _size, sortBy: _sort, sortOrder: _order, ...filters } = previous
  const changed = requirementQueryKey(filters) !== requirementQueryKey(props.filters)
  return table.load({ ...previous, ...props.filters,
    // 用完整过滤对象替换，清空筛选时不能残留旧字段。
    statusId: props.filters.statusId, assignee: props.filters.assignee, documentType: props.filters.documentType,
    excludeId: props.filters.excludeId, page: changed ? 1 : previous.page })
}
watch([() => requirementQueryKey(props.filters), () => props.enabled], () => { if (props.enabled) void load() })
watch(() => table.data.value?.total, value => { if (value !== undefined) emit('total', value) }, { immediate: true })
onServerPrefetch(load)
onMounted(load)
const committed = computed(() => table.committedQuery.value)
function changePage(next: BingTablePageChangePayload) { void table.load({ ...table.targetQuery.value, page: next.page, pageSize: next.pageSize }) }
function changeSort(next: BingTableSortPayload) {
  void table.load({ ...table.targetQuery.value, page: 1, sortBy: next.key as RequirementSortKey | undefined || undefined, sortOrder: next.order ?? undefined })
}
</script>

<template>
  <div class="paged-requirements" :aria-busy="table.pending.value">
    <div v-if="table.error.value" class="workspace-feedback" role="alert"><span>{{ table.error.value }}</span><BingButton variant="secondary" size="sm" :loading="table.pending.value" @click="table.retry">重试</BingButton></div>
    <RequirementTable :requirements="table.items.value" :page="committed.page" :page-size="committed.pageSize" :total="table.data.value?.total ?? 0"
      :sort-by="committed.sortBy" :sort-order="committed.sortOrder" :loading="table.pending.value" :compact="compact" :label="label" :empty-text="emptyText"
      :columns-state="columnsState" :show-column-controls="showColumnControls" @update:columns-state="emit('update:columnsState', $event)"
      @page-change="changePage" @sort-change="changeSort" />
  </div>
</template>
