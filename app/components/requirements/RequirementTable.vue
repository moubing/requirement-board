<script setup lang="ts">
import { computed } from 'vue'
import { BingTable, BingTag } from '@moubing/bing-ui'
import type { BingTableRow, BingTablePageChangePayload, BingTableSortPayload } from '@moubing/bing-ui'
import { DOCUMENT_TYPE_LABELS } from '#shared/documents/workflow'
import type { RequirementSortKey } from '#shared/requirements/query'
import type { BoardRequirement } from '~/types/requirement-board'
import { requirementColumns, type RequirementColumnPreferences } from '~/utils/requirement-columns'

const props = withDefaults(defineProps<{
  requirements: BoardRequirement[]
  page: number
  pageSize: number
  total: number
  sortBy?: RequirementSortKey
  sortOrder?: 'asc' | 'desc'
  columnsState: RequirementColumnPreferences
  showColumnControls?: boolean
  loading?: boolean
  compact?: boolean
  label?: string
  emptyText?: string
}>(), { loading: false, compact: false, showColumnControls: true, label: '文档列表', emptyText: '没有匹配的文档' })
const emit = defineEmits<{ pageChange: [payload: BingTablePageChangePayload]; sortChange: [payload: BingTableSortPayload];
  'update:columnsState': [value: RequirementColumnPreferences] }>()
const columns = computed(() => requirementColumns(props.compact))
const rows = computed<BingTableRow[]>(() => props.requirements.map(requirement => ({
  ...requirement,
  documentType: DOCUMENT_TYPE_LABELS[requirement.documentType ?? 'requirement'],
  status: requirement.status.name,
  statusColor: requirement.status.color,
  assignees: requirement.assignees.map(user => user.name).join('、') || '未指派',
  assigneeColor: requirement.assignees[0]?.avatarColor ?? 'var(--bing-muted)',
  reporterName: requirement.reporter.name,
})))
function date(value: unknown) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(String(value)))
}
function priorityLabel(value: unknown) { return { low: '低', medium: '中', high: '高' }[String(value)] ?? '中' }
</script>

<template>
  <BingTable
    :page="page" :page-size="pageSize" :total="total" :default-page-size="compact ? 5 : 10" :page-size-options="compact ? [5, 10, 20] : [10, 20, 50]" class="requirement-table"
    :sort-key="sortBy ?? null" :sort-order="sortOrder ?? null" remote-sort remote-pagination
    :data="rows" :columns="columns" row-key="id" :loading="loading" :striped="false" :bordered="false"
    :virtual="false" :virtual-row-height="56" pagination :show-column-controls="showColumnControls" reorderable-columns resizable-columns
    :column-widths="columnsState.widths" :column-order="columnsState.order" :hidden-column-keys="columnsState.hidden" :column-fixed="columnsState.fixed"
    @update:column-widths="emit('update:columnsState', { ...columnsState, widths: $event })"
    @update:column-order="emit('update:columnsState', { ...columnsState, order: $event })"
    @update:hidden-column-keys="emit('update:columnsState', { ...columnsState, hidden: $event })"
    @update:column-fixed="emit('update:columnsState', { ...columnsState, fixed: $event })"
    :preserve-page-height="false" :empty-text="emptyText" loading-text="正在加载文档" :aria-label="label"
    @page-change="emit('pageChange', $event)" @sort-change="emit('sortChange', $event)"
  >
    <template #cell-key="{ row, value }">
      <NuxtLink class="requirement-key-link" :to="`/requirements/${String(row.id)}`">{{ value }}</NuxtLink>
    </template>
    <template #cell-title="{ row, value }">
      <NuxtLink class="requirement-title-link" :to="`/requirements/${String(row.id)}`" :title="String(value)"><span>{{ value }}</span></NuxtLink>
    </template>
    <template #cell-status="{ row, value }">
      <span class="requirement-status"><span :style="{ background: String(row.statusColor) }" aria-hidden="true" />{{ value }}</span>
    </template>
    <template #cell-priority="{ value }"><BingTag size="sm" :tone="value === 'high' ? 'warning' : 'neutral'" variant="soft">{{ priorityLabel(value) }}</BingTag></template>
    <template #cell-assignees="{ row, value }">
      <span class="requirement-person"><span class="requirement-person__dot" :style="{ background: String(row.assigneeColor) }" aria-hidden="true" />{{ value }}</span>
    </template>
    <template #cell-updatedAt="{ value }"><time class="requirement-time" :datetime="String(value)" :title="String(value)">{{ date(value) }}</time></template>
    <template #cell-createdAt="{ value }"><time class="requirement-time" :datetime="String(value)" :title="String(value)">{{ date(value) }}</time></template>
  </BingTable>
</template>
