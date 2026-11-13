<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDiffLayout } from '~/composables/use-diff-layout'
import { scrollToContent } from '~/utils/scroll-to-content'
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  ExternalLink,
  Rows2,
} from 'lucide-vue-next'
import {
  BingButton,
  BingCheckbox,
  BingIcon,
  BingScrollbar,
  BingTable,
  BingTag,
} from '@moubing/bing-ui'
import type {
  BingScrollbarExpose,
  BingTableColumn,
  BingTableRow,
  BingTagTone,
} from '@moubing/bing-ui'

import {
  buildSelectionHistory,
  type SelectionHistoryAnchor,
  type SelectionHistoryEntry,
  type SelectionHistorySegmentDiff,
  type SelectionHistoryVersion,
} from '~~/shared/diff/selection-history'
import DiffChangeGutter from './DiffChangeGutter.vue'
import type { DiffVisualStatus } from './diff-presentation'
import SelectionHistoryDiffContent from './SelectionHistoryDiffContent.vue'
import RequirementChapterLinks from '../editor/RequirementChapterLinks.vue'
import DiffNodeContributors from './DiffNodeContributors.vue'

const chapterSurface = ref<HTMLElement | null>(null)

const props = defineProps<{
  anchor: SelectionHistoryAnchor
  versions: SelectionHistoryVersion[]
  requirementId?: string
  attributionPending?: boolean
}>()

const emit = defineEmits<{
  'open-revision': [revisionId: string]
}>()

interface HistoryTableRow extends BingTableRow {
  id: string
  label: string
  date: string
  author: string
  note: string
  entry: SelectionHistoryEntry
}

const tableColumns: BingTableColumn[] = [
  { key: 'label', title: '版本', width: 116, fixed: 'left' },
  { key: 'date', title: '日期', width: 176 },
  { key: 'author', title: '保存人', width: 116 },
  { key: 'note', title: '版本说明', minWidth: 240, ellipsis: true },
  { key: 'status', title: '选区变化', width: 130 },
  { key: 'action', title: '操作', width: 156, fixed: 'right', align: 'right' },
]

const workspaceRoot = ref<HTMLElement | null>(null)
const diffScrollbar = ref<BingScrollbarExpose | null>(null)
const showOnlyChanged = ref(true)
const layout = useDiffLayout()
const activeEntryId = ref('')
const activeSegmentId = ref('')

const history = computed(() => buildSelectionHistory(props.anchor, props.versions))
const visibleEntries = computed(() => showOnlyChanged.value ? history.value.changedEntries : history.value.entries)
const activeEntry = computed(() =>
  history.value.entries.find((entry) => entry.id === activeEntryId.value)
    ?? visibleEntries.value[0]
    ?? null,
)
const navigationSegments = computed(() => {
  if (!activeEntry.value) return []
  return activeEntry.value.segments.filter((segment) => segment.changed)
})
const activeSegmentIndex = computed(() =>
  navigationSegments.value.findIndex((segment) => segment.id === activeSegmentId.value),
)
const changePosition = computed(() => {
  if (!navigationSegments.value.length) return '0 / 0'
  const index = activeSegmentIndex.value < 0 ? 0 : activeSegmentIndex.value
  return `${index + 1} / ${navigationSegments.value.length}`
})
const nodeContributors = computed(() => new Map(activeEntry.value?.target.attribution?.nodes.map(node => [node.id, node]) ?? []))
const contributorsPending = computed(() => Boolean(activeEntry.value?.target.draft && props.attributionPending))
const tableRows = computed<HistoryTableRow[]>(() =>
  visibleEntries.value.map((entry) => ({
    id: entry.id,
    label: entry.target.label,
    date: entry.target.draft ? '当前未保存' : formatDate(entry.target.createdAt),
    author: entry.target.draft ? '尚未保存版本' : entry.target.author || '—',
    note: entry.target.draft ? '当前草稿' : entry.target.changeNote || '—',
    entry,
  })),
)

watch(
  visibleEntries,
  (entries) => {
    if (!entries.some((entry) => entry.id === activeEntryId.value)) {
      activeEntryId.value = entries[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch(
  activeEntry,
  (entry) => {
    if (!entry) {
      activeSegmentId.value = ''
      return
    }
    activeSegmentId.value = entry.segments.find((segment) => segment.changed)?.id ?? ''
  },
  { immediate: true },
)

function selectEntry(entry: SelectionHistoryEntry) {
  activeEntryId.value = entry.id
}

function handleRowActivate(row: BingTableRow) {
  selectEntry(tableEntry(row))
}

function tableEntry(row: BingTableRow) {
  return (row as HistoryTableRow).entry
}

function navigateChange(direction: -1 | 1) {
  const segments = navigationSegments.value
  if (!segments.length) return
  const current = activeSegmentIndex.value
  const next = current < 0
    ? direction > 0 ? 0 : segments.length - 1
    : (current + direction + segments.length) % segments.length
  activeSegmentId.value = segments[next]?.id ?? ''
  void nextTick(() => {
    scrollToContent(diffScrollbar.value,
      workspaceRoot.value?.querySelector<HTMLElement>('[data-selection-history-active="true"]'))
  })
}

function openRevision(entry: SelectionHistoryEntry) {
  if (entry.target.draft) return
  emit('open-revision', entry.target.id)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(entry: SelectionHistoryEntry) {
  if (entry.status === 'introduced') return '首次出现'
  if (!entry.changed) return '未影响选区'
  return entry.changeCount > 1 ? `${entry.changeCount} 处变化` : '1 处变化'
}

function statusTone(entry: SelectionHistoryEntry): BingTagTone {
  if (entry.confidence === 'lost') return 'warning'
  if (entry.status === 'introduced') return 'success'
  return entry.changed ? 'primary' : 'neutral'
}

function confidenceLabel(entry: SelectionHistoryEntry) {
  if (entry.confidence === 'inferred') return '块发生拆分，已通过唯一文本推断'
  if (entry.confidence === 'lost') return '更早版本无法可靠定位，追踪在这里停止'
  return ''
}

function segmentVisualStatus(segment: SelectionHistorySegmentDiff): DiffVisualStatus {
  if (segment.status === 'introduced') return 'inserted'
  return segment.status
}
</script>

<template>
  <div ref="workspaceRoot" class="selection-history-workspace">
    <section class="selection-history-dialog__diff" aria-label="选区内容比较" aria-live="polite">
      <div class="selection-history-dialog__toolbar">
        <div class="selection-history-dialog__tools">
          <strong>内容变化</strong>
          <div class="selection-history-dialog__navigation" aria-label="差异导航">
            <BingButton
              size="sm"
              variant="ghost"
              rounded="sm"
              :disabled="!navigationSegments.length"
              :throttle="false"
              aria-label="上一处选区差异"
              @click="navigateChange(-1)"
            >
              <template #prefix><BingIcon :icon="ArrowUp" :size="15" decorative /></template>
            </BingButton>
            <BingButton
              size="sm"
              variant="ghost"
              rounded="sm"
              :disabled="!navigationSegments.length"
              :throttle="false"
              aria-label="下一处选区差异"
              @click="navigateChange(1)"
            >
              <template #prefix><BingIcon :icon="ArrowDown" :size="15" decorative /></template>
            </BingButton>
            <span>{{ changePosition }}</span>
          </div>
        </div>

        <div class="selection-history-dialog__layout" aria-label="Diff 布局">
          <BingButton
            size="sm"
            :variant="layout === 'split' ? 'secondary' : 'ghost'"
            rounded="sm"
            :aria-pressed="layout === 'split'"
            aria-label="并排 Diff"
            @click="layout = 'split'"
          >
            <template #prefix><BingIcon :icon="Columns2" :size="15" decorative /></template>
            并排
          </BingButton>
          <BingButton
            size="sm"
            :variant="layout === 'unified' ? 'secondary' : 'ghost'"
            rounded="sm"
            :aria-pressed="layout === 'unified'"
            aria-label="统一 Diff"
            @click="layout = 'unified'"
          >
            <template #prefix><BingIcon :icon="Rows2" :size="15" decorative /></template>
            统一
          </BingButton>
        </div>
      </div>

        <template v-if="activeEntry">
          <header class="selection-history-dialog__diff-header">
            <div>
              <strong>{{ activeEntry.base?.label ?? '尚未出现' }}</strong>
              <span>旧内容</span>
            </div>
            <span class="selection-history-dialog__diff-summary">
              <BingTag size="sm" variant="soft" :tone="statusTone(activeEntry)">
                {{ statusLabel(activeEntry) }}
              </BingTag>
              <small v-if="confidenceLabel(activeEntry)">{{ confidenceLabel(activeEntry) }}</small>
              <small v-if="contributorsPending">打开时有修改待同步，修改人名单可能不完整</small>
            </span>
            <div>
              <strong>{{ activeEntry.target.label }}</strong>
              <span>新内容</span>
            </div>
          </header>

          <BingScrollbar
            ref="diffScrollbar"
            class="selection-history-dialog__diff-scroll"
            horizontal
            max-height="min(56dvh, 640px)"
            always
            smooth
            aria-label="选区历史差异内容"
          >
            <div ref="chapterSurface" style="position: relative">
            <RequirementChapterLinks v-if="requirementId" inline :requirement-id="requirementId" :surface="chapterSurface" :get-viewport="() => diffScrollbar?.viewport" />
            <article
              v-for="segment in activeEntry.segments"
              :key="segment.id"
              class="rich-diff__row selection-history-diff__segment"
              :class="[
                `rich-diff__row--${segmentVisualStatus(segment)}`,
                { 'rich-diff__row--active': segment.id === activeSegmentId },
                { 'selection-history-diff__segment--unified': layout === 'unified' },
              ]"
              :data-selection-history-active="segment.id === activeSegmentId ? 'true' : undefined"
              :aria-current="segment.id === activeSegmentId ? 'true' : undefined"
              :data-node-id="segment.targetBlockId"
            >
              <template v-if="layout === 'split'">
                <div class="selection-history-diff__content selection-history-diff__content--base">
                  <SelectionHistoryDiffContent :segment="segment" side="base" />
                </div>
                <DiffChangeGutter class="selection-history-diff__gutter" :status="segmentVisualStatus(segment)">
                  <DiffNodeContributors :node="nodeContributors.get(segment.targetBlockId)" :changed="segment.changed" :pending="contributorsPending" />
                </DiffChangeGutter>
                <div class="selection-history-diff__content selection-history-diff__content--target">
                  <SelectionHistoryDiffContent :segment="segment" side="target" />
                </div>
              </template>

              <div v-else class="selection-history-diff__unified">
                <DiffNodeContributors :node="nodeContributors.get(segment.targetBlockId)" :changed="segment.changed" :pending="contributorsPending" inline />
                <div
                  v-if="segment.changed && segment.baseNode"
                  class="selection-history-diff__unified-row selection-history-diff__unified-row--base"
                >
                  <span aria-hidden="true">−</span>
                  <div>
                    <SelectionHistoryDiffContent :segment="segment" side="base" />
                  </div>
                </div>
                <div
                  class="selection-history-diff__unified-row selection-history-diff__unified-row--target"
                  :class="{
                    'selection-history-diff__unified-row--introduced': segment.status === 'introduced',
                  }"
                >
                  <span aria-hidden="true">{{ segment.changed ? '+' : '' }}</span>
                  <div>
                    <SelectionHistoryDiffContent :segment="segment" side="target" />
                  </div>
                </div>
              </div>
            </article>
            </div>
          </BingScrollbar>
        </template>

        <div v-else class="selection-history-dialog__empty">
          没有可追踪的历史记录。
        </div>
      </section>

      <section class="selection-history-dialog__versions" aria-label="选区历史版本">
        <header>
          <div>
            <strong>版本记录</strong>
            <span>{{ visibleEntries.length }} / {{ history.entries.length }}</span>
          </div>
          <BingCheckbox v-model="showOnlyChanged" size="sm" label="仅更改" />
        </header>

        <BingTable
          :data="tableRows"
          :columns="tableColumns"
          row-key="id"
          size="sm"
          :bordered="false"
          :striped="false"
          :virtual="false"
          :show-column-controls="false"
          :active-row-key="activeEntryId"
          max-height="clamp(220px, 26vh, 300px)"
          empty-text="选区在历史版本中没有变化"
          aria-label="选区历史版本列表"
          @row-activate="handleRowActivate"
        >
          <template #cell-label="{ row, value }">
            <strong :class="{ 'selection-history-table__current': tableEntry(row).target.draft }">
              {{ value }}
            </strong>
          </template>
          <template #cell-status="{ row }">
            <BingTag size="sm" variant="soft" :tone="statusTone(tableEntry(row))">
              {{ statusLabel(tableEntry(row)) }}
            </BingTag>
          </template>
          <template #cell-action="{ row }">
            <BingButton
              size="xs"
              variant="ghost"
              rounded="sm"
              :disabled="tableEntry(row).target.draft"
              aria-label="比较完整版本差异"
              @click.stop="openRevision(tableEntry(row))"
            >
              <template #prefix><BingIcon :icon="ExternalLink" :size="13" decorative /></template>
              完整比较
            </BingButton>
          </template>
        </BingTable>
      </section>
  </div>
</template>

<style scoped>
.selection-history-diff__segment { grid-template-columns: minmax(0, 1fr) 160px minmax(0, 1fr); }
.selection-history-diff__gutter { min-width: 0; gap: 5px; padding-block: 8px; }
.selection-history-diff__segment--unified { min-width: 0; }
.selection-history-dialog__diff-summary { flex-wrap: wrap; }
</style>
