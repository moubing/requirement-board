<script setup lang="ts">
import { computed, onMounted, onScopeDispose, onServerPrefetch, ref, watch } from 'vue'
import { BingButton, BingCard, BingIcon, BingInput, BingSelect, BingTabs, BingTableColumnControls, BingTag } from '@moubing/bing-ui'
import type { BingSelectModelValue, BingTabValue } from '@moubing/bing-ui'
import { ChevronDown, ChevronRight, List, Rows3, RotateCcw, Search } from 'lucide-vue-next'
import PagedRequirementTable from '~/components/requirements/PagedRequirementTable.vue'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, documentStates, type DocumentType } from '#shared/documents/workflow'
import type { RequirementFilters } from '#shared/requirements/query'
import { useBoardMeta } from '~/composables/use-board-meta'
import { useRequirementCache } from '~/composables/use-requirement-cache'
import { useRequirementGroups } from '~/composables/use-requirement-groups'
import { emptyRequirementColumns, requirementColumns } from '~/utils/requirement-columns'

useHead({ title: '文档列表 · 文档看板' })
const route = useRoute()
const metadata = useBoardMeta()
const meta = metadata.data
const cache = useRequirementCache()
const controls = cache.session('documents:controls', () => ({ q: '', status: '' as BingSelectModelValue,
  documentType: '' as BingSelectModelValue, assignee: '' as BingSelectModelValue, reporter: '', stale: false, view: 'table' as BingTabValue,
  expanded: [] as string[], initialized: false, total: null as number | null }))
const columns = cache.session('documents:columns', emptyRequirementColumns)
const definitions = requirementColumns()
const search = computed({ get: () => controls.value.q, set: value => { controls.value.q = value } })
const status = computed({ get: () => controls.value.status, set: value => { controls.value.status = value } })
const documentType = computed({ get: () => controls.value.documentType, set: value => { controls.value.documentType = value } })
const assignee = computed({ get: () => controls.value.assignee, set: value => { controls.value.assignee = value } })
const view = computed({ get: () => controls.value.view, set: value => { controls.value.view = value } })
const reporter = computed({ get: () => controls.value.reporter, set: value => { controls.value.reporter = value } })
const stale = computed({ get: () => controls.value.stale, set: value => { controls.value.stale = value } })
// 带筛选参数进入（例如从工作台的数字和格子）时，以链接为准替换全部筛选，避免叠加上次留下的条件。
const URL_FILTERS = ['q', 'documentType', 'statusId', 'assignee', 'reporter', 'stale'] as const
watch(() => URL_FILTERS.map(key => route.query[key]), values => {
  if (values.every(value => typeof value !== 'string')) return
  const read = (key: typeof URL_FILTERS[number]) => { const value = route.query[key]; return typeof value === 'string' ? value : '' }
  const type = read('documentType')
  documentType.value = (DOCUMENT_TYPES as readonly string[]).includes(type) ? type : ''
  search.value = read('q'); status.value = read('statusId'); assignee.value = read('assignee')
  reporter.value = read('reporter'); stale.value = read('stale') === '1'
}, { immediate: true })
const typeOptions = [{ value: '', label: '全部类型' }, ...DOCUMENT_TYPES.map(value => ({ value, label: DOCUMENT_TYPE_LABELS[value] }))]
// 切换类型后，当前状态不属于该类型时才清除。
watch(documentType, type => {
  const code = meta.value?.statuses.find(item => item.id === status.value)?.code
  if (status.value && meta.value && (!code || (type && !documentStates(type as DocumentType).includes(code as never)))) status.value = ''
})
const views = [{ value: 'table', label: '全部列表' }, { value: 'grouped', label: '按状态分组' }]
const statusOptions = computed(() => [{ value: '', label: '全部状态' }, ...(meta.value?.statuses ?? []).filter(item => !documentType.value || documentStates(documentType.value as DocumentType).includes(item.code as never)).map(item => ({ value: item.id, label: item.name }))])
const assigneeOptions = computed(() => [
  { value: '', label: '全部负责人' }, { value: 'me', label: '我负责的' }, { value: 'unassigned', label: '未指派' },
  ...(meta.value?.users ?? []).map(user => ({ value: user.id, label: user.name })),
])
const queryText = ref(search.value)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, value => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { queryText.value = value }, value ? 200 : 0) })
onScopeDispose(() => clearTimeout(searchTimer))
const filters = computed<RequirementFilters>(() => ({ q: queryText.value.trim(),
  documentType: documentType.value ? documentType.value as DocumentType : undefined,
  statusId: status.value ? String(status.value) : undefined, assignee: assignee.value ? String(assignee.value) : undefined,
  reporter: reporter.value || undefined, stale: stale.value ? '1' : undefined }))
const reporterLabel = computed(() => reporter.value === 'me' ? '我' : meta.value?.users.find(user => user.id === reporter.value)?.name ?? reporter.value)
const groups = useRequirementGroups(filters.value, () => view.value === 'grouped')
const nonemptyGroups = computed(() => groups.data.value?.groups.filter(group => group.count > 0) ?? [])
watch(() => groups.data.value, value => {
  if (!value || controls.value.initialized) return
  controls.value.expanded = value.groups.find(group => group.count > 0) ? [value.groups.find(group => group.count > 0)!.id] : []
  controls.value.initialized = true
}, { immediate: true })
watch([filters, view], () => { if (view.value === 'grouped') void groups.load(filters.value) })
async function load() { await Promise.all([metadata.refresh(), view.value === 'grouped' ? groups.load(filters.value) : Promise.resolve()]) }
onServerPrefetch(load); onMounted(load)
function toggleGroup(id: string) {
  controls.value.expanded = controls.value.expanded.includes(id) ? controls.value.expanded.filter(value => value !== id) : [...controls.value.expanded, id]
}
const hasFilters = computed(() => Boolean(search.value || status.value || assignee.value || documentType.value || reporter.value || stale.value))
function resetFilters() { documentType.value = ''; search.value = ''; status.value = ''; assignee.value = ''; reporter.value = ''; stale.value = false }
</script>

<template>
  <main class="workspace-page requirements-list-page">
    <h1 class="visually-hidden">文档</h1>
    <div v-if="metadata.error.value" class="workspace-feedback" role="alert"><span>{{ metadata.error.value }}</span><BingButton variant="secondary" size="sm" :loading="metadata.pending.value" @click="metadata.refresh(true)">重试筛选选项</BingButton></div>
    <div class="workspace-content">
      <BingCard class="requirement-list-card" variant="plain" padding="none" rounded="md"
        :glass="false" :interactive="false" :tilt="false" :glare="false" entrance="none" flip-trigger="none">
        <div class="requirement-list-controls">
          <header class="requirement-list-toolbar">
            <BingTabs v-model="view" :items="views" class="requirement-view-tabs" variant="soft" size="lg" aria-label="文档列表视图">
              <template #item="{ item, active }"><span class="requirement-view-tab" :class="{ 'is-active': active }"><BingIcon :icon="item.value === 'table' ? List : Rows3" :size="16" decorative />{{ item.label }}</span></template>
            </BingTabs>
            <div class="requirement-list-actions">
              <span class="workspace-count" aria-live="polite">共 <strong>{{ (view === 'grouped' ? groups.data.value?.total : controls.total) ?? '—' }}</strong> 条</span>
              <BingTableColumnControls v-if="view === 'grouped'" :columns="definitions" aria-label="所有分组的列设置"
                v-model:column-widths="columns.widths" v-model:column-order="columns.order" v-model:hidden-column-keys="columns.hidden" v-model:column-fixed="columns.fixed" />
            </div>
          </header>
          <section class="requirement-filters" aria-label="筛选文档">
            <BingInput v-model="search" :icon="Search" placeholder="搜索标题或编号" aria-label="搜索标题或编号" clearable block />
            <BingSelect v-model="documentType" :options="typeOptions" :clearable="false" :searchable="false" :min-width="0" block aria-label="筛选文档类型" />
            <BingSelect v-model="status" :options="statusOptions" :clearable="false" :searchable="false" :min-width="0" block aria-label="筛选状态" />
            <BingSelect v-model="assignee" :options="assigneeOptions" :clearable="false" :min-width="0" block aria-label="筛选负责人" />
            <BingButton variant="ghost" :disabled="!hasFilters" @click="resetFilters"><BingIcon :icon="RotateCcw" :size="16" decorative />清除筛选</BingButton>
            <div v-if="reporter || stale" class="requirement-filter-tags" aria-label="其他筛选条件" role="group">
              <BingTag v-if="reporter" :label="`提出人：${reporterLabel}`" size="sm" tone="primary" variant="soft" closable closeAriaLabel="移除提出人筛选" @close="reporter = ''" />
              <BingTag v-if="stale" label="停滞" size="sm" tone="warning" variant="soft" closable closeAriaLabel="移除停滞筛选" @close="stale = false" />
            </div>
          </section>
        </div>
        <div class="requirement-list-results">
          <PagedRequirementTable v-if="view === 'table'" query-key="documents:table" :filters="filters" v-model:columns-state="columns" @total="controls.total = $event"
            :empty-text="hasFilters ? '没有匹配的文档，试试调整筛选条件' : '还没有文档，点击上方新建文档开始'" />
          <section v-else class="status-tables" aria-label="按状态分组的文档列表" :aria-busy="groups.pending.value">
            <div v-if="groups.error.value" class="workspace-feedback" role="alert"><span>{{ groups.error.value }}</span><BingButton variant="secondary" size="sm" :loading="groups.pending.value" @click="groups.retry">重试分组</BingButton></div>
            <p v-if="groups.pending.value && !groups.data.value" class="workspace-empty" role="status">正在加载分组…</p>
            <p v-else-if="groups.data.value && !nonemptyGroups.length" class="workspace-empty">没有匹配的文档，试试调整筛选条件</p>
            <article v-for="group in nonemptyGroups" :key="group.id" class="workspace-panel">
              <header class="workspace-panel__heading"><h2><BingButton variant="ghost" :throttle="false" :aria-expanded="controls.expanded.includes(group.id)" :aria-label="`${controls.expanded.includes(group.id) ? '收起' : '展开'}${group.name}分组`" @click="toggleGroup(group.id)">
                <BingIcon :icon="controls.expanded.includes(group.id) ? ChevronDown : ChevronRight" :size="16" decorative /><span class="requirement-status"><span :style="{ background: group.color }" aria-hidden="true" />{{ group.name }}<small>{{ group.count }}</small></span>
              </BingButton></h2></header>
              <PagedRequirementTable v-if="controls.expanded.includes(group.id)" :query-key="`documents:group:${group.id}`" :filters="{ ...groups.committedQuery.value, statusId: group.id }"
                v-model:columns-state="columns" :show-column-controls="false" :label="`${group.name}文档列表`" empty-text="此状态下没有匹配的文档" />
            </article>
          </section>
        </div>
      </BingCard>
    </div>
  </main>
</template>
