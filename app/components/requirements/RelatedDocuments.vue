<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { BingButton, BingCheckbox, BingDialog, BingDropDown, BingDropDownItem, BingIcon, BingInput, BingScrollbar } from '@moubing/bing-ui'
import type { BingScrollbarExpose } from '@moubing/bing-ui'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Ellipsis, ExternalLink, Link2, Plus, Search, Unlink, X } from 'lucide-vue-next'
import { MAX_RELATED_DOCUMENT_SELECTION, type RelatedDocumentDto } from '#shared/requirements/relations'
import { usePagedRequirements } from '../../composables/use-paged-requirements'
import { draftError } from '#shared/drafts/document'
import type { BoardRequirement } from '../../types/requirement-board'

const props = defineProps<{
  requirementId: string
  title: string
  items: RelatedDocumentDto[]
  loading: boolean
  error: boolean
  saving: boolean
  disabled: boolean
  addDocuments: (ids: string[]) => Promise<void>
  removeDocument: (id: string) => Promise<void>
}>()
const emit = defineEmits<{ retry: [] }>()
const formId = useId()
const open = ref(false)
const expanded = ref(false)
const query = ref('')
const pageSize = 8
const documents = usePagedRequirements(`related:${props.requirementId}`, { q: '', excludeId: props.requirementId, page: 1, pageSize }, () => open.value)
const page = computed(() => documents.committedQuery.value.page)
const resultsScrollbar = ref<BingScrollbarExpose | null>(null)
const selected = ref<BoardRequirement[]>([])
const saveError = ref('')
const rowError = ref('')
const lastRemoved = ref<RelatedDocumentDto | null>(null)
const removedMessage = ref('')
let disposed = false
let queryTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => { disposed = true; clearTimeout(queryTimer) })

const linkedIds = computed(() => new Set(props.items.map(item => item.id)))
const visibleItems = computed(() => expanded.value ? props.items : props.items.slice(0, 3))
const unavailable = computed(() => props.disabled || props.saving)
const totalPages = computed(() => Math.max(1, Math.ceil((documents.data.value?.total ?? 0) / pageSize)))
const results = documents.items
const selectedIds = computed(() => new Set(selected.value.map(item => item.id)))
function loadPage(next = 1, force = false) { return documents.load({ q: query.value.trim(), excludeId: props.requirementId, page: next, pageSize }, force) }
watch(query, () => { clearTimeout(queryTimer); documents.cancel(); queryTimer = setTimeout(() => { void loadPage() }, query.value ? 160 : 0) })
watch([query, page], () => resultsScrollbar.value?.scrollTo(0), { flush: 'post' })
watch(linkedIds, ids => { selected.value = selected.value.filter(item => !ids.has(item.id)) })
watch(open, value => {
  if (!value) { clearTimeout(queryTimer); return }
  if (!saveError.value && !props.saving) { query.value = ''; selected.value = [] }
  void loadPage(1, true)
})

function select(item: BoardRequirement, checked: boolean) {
  if (unavailable.value || linkedIds.value.has(item.id)) return
  selected.value = selected.value.filter(value => value.id !== item.id)
  if (checked && selected.value.length < MAX_RELATED_DOCUMENT_SELECTION) selected.value.push(item)
}
async function confirm() {
  if (unavailable.value || !selected.value.length || props.error) return
  saveError.value = ''
  // 保存前固定本次选择，不让另一侧的广播改变正在提交的名单。
  const ids = selected.value.map(item => item.id)
  open.value = false
  try {
    await props.addDocuments(ids)
    if (disposed) return
    expanded.value = true; lastRemoved.value = null; removedMessage.value = ''
  } catch (error) { if (!disposed) saveError.value = draftError(error) }
}
async function remove(item: RelatedDocumentDto) {
  if (unavailable.value) return
  rowError.value = ''
  try {
    await props.removeDocument(item.id)
    if (disposed) return
    lastRemoved.value = item; removedMessage.value = '已解除关联，文档保留'
  } catch (error) { if (!disposed) rowError.value = draftError(error) }
}
async function undo() {
  if (!lastRemoved.value || unavailable.value) return
  rowError.value = ''
  try {
    await props.addDocuments([lastRemoved.value.id])
    if (disposed) return
    lastRemoved.value = null; removedMessage.value = '已恢复关联'
  } catch (error) { if (!disposed) rowError.value = draftError(error) }
}
</script>

<template>
  <section class="related-documents" aria-label="关联文档">
    <header class="related-documents__header">
      <h3>关联文档</h3><span v-if="!error" class="related-documents__count">{{ items.length }}</span>
      <BingButton variant="ghost" size="sm" :disabled="unavailable || error || loading" :throttle="false" aria-label="添加关联文档" @click="open = true">
        <template #prefix><BingIcon :icon="Plus" :size="14" decorative /></template>添加
      </BingButton>
    </header>
    <div v-if="error" class="related-documents__message" role="alert">
      <p>关联文档加载失败</p><BingButton variant="secondary" size="sm" :loading="loading" @click="emit('retry')">重试加载关联文档</BingButton>
    </div>
    <div v-else-if="loading && !items.length" class="related-documents__message" role="status">正在加载关联文档…</div>
    <div v-else class="related-documents__list" :aria-busy="saving">
      <div v-if="!items.length" class="related-documents__empty"><BingIcon :icon="Link2" :size="20" decorative /><p>还没有关联文档</p><small>添加相关文档，方便一起查阅</small></div>
      <div v-for="item in visibleItems" :key="item.id" class="related-documents__row">
        <NuxtLink :to="`/requirements/${encodeURIComponent(item.id)}`" target="_blank" rel="noopener noreferrer" class="related-documents__link" :title="item.title" :aria-label="`${item.key} ${item.title}（在新标签页打开）`">
          <span class="related-documents__title"><span>{{ item.title }}</span><BingIcon :icon="ExternalLink" :size="12" decorative /></span>
          <span class="related-documents__meta"><span>{{ item.key }}</span><span class="related-documents__status"><i :style="{ backgroundColor: item.status.color }" aria-hidden="true" />{{ item.status.name }}</span></span>
        </NuxtLink>
        <BingDropDown placement="bottom-end" :min-width="150" :auto-focus="true" :aria-label="`${item.key} 关联操作`">
          <template #trigger="{ triggerProps }"><BingButton v-bind="triggerProps" variant="ghost" size="sm" :disabled="unavailable" :throttle="false" :aria-label="`${item.key} 更多操作`"><BingIcon :icon="Ellipsis" :size="16" decorative /></BingButton></template>
          <BingDropDownItem title="解除关联" :icon="Unlink" :disabled="unavailable" @click="remove(item)" />
        </BingDropDown>
      </div>
      <BingButton v-if="items.length > 3" class="related-documents__expand" variant="ghost" size="sm" block :throttle="false" @click="expanded = !expanded">
        {{ expanded ? '收起' : `展开另外 ${items.length - 3} 篇` }}<template #suffix><BingIcon :icon="expanded ? ChevronUp : ChevronDown" :size="14" decorative /></template>
      </BingButton>
    </div>
    <p v-if="items.length && !error" class="related-documents__hint"><BingIcon :icon="ExternalLink" :size="12" decorative />点击标题，在新标签页打开</p>
    <p v-if="rowError" class="related-documents__error" role="alert">{{ rowError }}</p>
    <p v-if="saveError && !open" class="related-documents__error" role="alert">{{ saveError }}，选择已保留。<BingButton size="sm" variant="ghost" :disabled="unavailable" @click="open = true">重试添加关联</BingButton></p>
    <div v-if="removedMessage" class="related-documents__undo" role="status"><span>{{ removedMessage }}</span><BingButton v-if="lastRemoved" size="sm" variant="ghost" :disabled="unavailable" @click="undo">撤销</BingButton></div>

    <BingDialog :busy="saving" v-model="open" title="添加关联文档" :width="640" :show-peek="false">
      <form :id="formId" class="related-picker" @submit.prevent="confirm">
        <p class="related-picker__description" :title="`为「${title}」选择相关文档`">为「{{ title }}」选择相关文档</p>
        <BingInput v-model="query" type="search" placeholder="搜索文档标题或编号" aria-label="搜索关联文档" :icon="Search" :disabled="saving" block />
        <div class="related-picker__caption"><span>{{ query.trim() ? '搜索结果' : '最近更新' }}</span><span>可多选</span></div>
        <BingScrollbar ref="resultsScrollbar" height="100%" always aria-label="关联文档搜索结果">
          <div v-if="documents.error.value" class="related-picker__message" role="alert"><p>{{ documents.error.value }}</p><BingButton variant="secondary" size="sm" :loading="documents.pending.value" @click="documents.retry">重试搜索文档</BingButton></div>
          <div v-if="documents.pending.value && !documents.data.value" class="related-picker__message" role="status">正在加载文档…</div>
          <div v-else-if="!results.length" class="related-picker__message" role="status">{{ query.trim() ? '没有找到相关文档，试试其他关键词或编号。' : '暂无其他可关联的文档。' }}</div>
          <div v-else class="related-picker__results" :inert="documents.pending.value" :aria-busy="documents.pending.value">
            <div v-for="item in results" :key="item.id" class="related-picker__result" :class="{ 'related-picker__result--selected': selectedIds.has(item.id) }">
              <BingCheckbox :model-value="linkedIds.has(item.id) || selectedIds.has(item.id)" :aria-label="`${item.key} ${item.title}${linkedIds.has(item.id) ? '，已关联' : ''}`"
                :disabled="unavailable || linkedIds.has(item.id) || (selected.length >= MAX_RELATED_DOCUMENT_SELECTION && !selectedIds.has(item.id))" @update:model-value="select(item, $event)">
                <span class="related-picker__result-copy"><span class="related-picker__result-title" :title="item.title">{{ item.title }}</span><span class="related-documents__meta"><span>{{ item.key }}</span><span class="related-documents__status"><i :style="{ backgroundColor: item.status.color }" aria-hidden="true" />{{ item.status.name }}</span></span></span>
              </BingCheckbox>
              <span v-if="linkedIds.has(item.id)" class="related-picker__linked">已关联</span>
            </div>
          </div>
        </BingScrollbar>
        <div class="related-picker__pagination"><span aria-live="polite">共 {{ documents.data.value?.total ?? '—' }} 篇文档</span><div><BingButton variant="ghost" size="sm" :disabled="page === 1 || documents.pending.value" :throttle="false" aria-label="上一页文档" @click="loadPage(page - 1)"><BingIcon :icon="ChevronLeft" :size="16" decorative /></BingButton><span>{{ page }} / {{ totalPages }}</span><BingButton variant="ghost" size="sm" :disabled="page === totalPages || documents.pending.value" :throttle="false" aria-label="下一页文档" @click="loadPage(page + 1)"><BingIcon :icon="ChevronRight" :size="16" decorative /></BingButton></div></div>
        <div class="related-picker__selection">
          <div class="related-picker__selection-header"><span aria-live="polite">已选择 {{ selected.length }} 篇</span><BingButton v-if="selected.length" variant="ghost" size="sm" :disabled="saving" @click="selected = []">清空</BingButton></div>
          <BingScrollbar v-if="selected.length" height="100%" aria-label="已选择的关联文档"><div class="related-picker__chips"><span v-for="item in selected" :key="item.id" class="related-picker__chip"><span :title="`${item.key} ${item.title}`">{{ item.title }}</span><BingButton variant="ghost" size="xs" :disabled="saving" :aria-label="`取消选择 ${item.key}`" @click="select(item, false)"><BingIcon :icon="X" :size="12" decorative /></BingButton></span></div><p v-if="selected.length >= MAX_RELATED_DOCUMENT_SELECTION" class="related-documents__hint">单次最多关联 {{ MAX_RELATED_DOCUMENT_SELECTION }} 篇文档</p></BingScrollbar>
          <p v-else class="related-documents__hint">勾选文档后，会显示在这里</p>
        </div>
        <BingScrollbar height="100%" aria-label="关联操作提示">
          <p v-if="saveError" class="related-documents__error" role="alert">{{ saveError }}</p>
          <p v-if="disabled" class="related-documents__error" role="status">当前文档暂时只读，请稍后再试。</p>
          <p v-if="error" class="related-documents__error" role="alert">关联列表加载失败，请关闭弹窗后重试。</p>
        </BingScrollbar>
      </form>
      <template #footer><div class="related-picker__footer"><span><BingIcon :icon="Link2" :size="14" decorative />关联后，双方文档均可看到</span><div><BingButton variant="secondary" :disabled="saving" @click="open = false">取消</BingButton><BingButton html-type="submit" :form="formId" :loading="saving" :disabled="unavailable || !selected.length || error">{{ selected.length ? `确认关联（${selected.length}）` : '确认关联' }}</BingButton></div></div></template>
    </BingDialog>
  </section>
</template>

<style scoped>
.related-documents { border-top: 1px solid var(--rb-border); padding-top: 16px; min-width: 0; }
.related-documents__header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.related-documents__header h3 { margin: 0; font-size: 14px; }
.related-documents__header > :last-child { margin-left: auto; }
.related-documents__count { border-radius: 4px; padding: 0 5px; font-size: 12px; color: var(--rb-muted); background: var(--rb-soft); }
.related-documents__list { border: 1px solid var(--rb-border); border-radius: 6px; }
.related-documents__row { display: flex; align-items: flex-start; gap: 4px; padding: 10px 4px 10px 10px; }
.related-documents__row + .related-documents__row { border-top: 1px solid var(--rb-border); }
.related-documents__row:hover { background: var(--rb-soft); }
.related-documents__link { min-width: 0; flex: 1; color: var(--rb-ink); text-decoration: none; }
.related-documents__link:hover { color: var(--rb-blue); }
.related-documents__title { display: flex; align-items: flex-start; gap: 4px; font-size: 13px; line-height: 1.6; }
.related-documents__title > span:first-child { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.related-documents__title > :last-child { flex-shrink: 0; margin-top: 4px; color: var(--rb-muted); }
.related-documents__meta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; color: var(--rb-muted); font-size: 12px; margin-top: 4px; }
.related-documents__status { display: inline-flex; align-items: center; gap: 5px; }
.related-documents__status i { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.related-documents__expand { border-top: 1px solid var(--rb-border); }
.related-documents__empty { padding: 24px 8px; text-align: center; color: var(--rb-muted); display: grid; justify-items: center; gap: 6px; font-size: 13px; }
.related-documents__empty p, .related-documents__empty small, .related-documents__message p { margin: 0; }
.related-documents__empty small { font-size: 12px; }
.related-documents__hint { display: flex; align-items: center; gap: 5px; margin: 8px 0 0; font-size: 12px; color: var(--rb-muted); }
.related-documents__hint > :first-child { flex-shrink: 0; }
.related-documents__message { display: grid; gap: 8px; justify-items: start; font-size: 13px; color: var(--rb-muted); }
.related-documents__error { color: var(--rb-red); font-size: 13px; overflow-wrap: anywhere; margin: 8px 0 0; }
.related-documents__undo { display: flex; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--rb-muted); gap: 4px; margin-top: 8px; }
.related-picker { display: grid; grid-template-rows: 22px 36px 20px minmax(0, 1fr) 32px 100px 40px; gap: 12px; min-width: 0; height: min(560px, calc(82dvh - 144px)); min-height: 440px; }
.related-picker__description { margin: 0; font-size: 13px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.related-picker__caption, .related-picker__pagination, .related-picker__selection-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--rb-muted); }
.related-picker__results { display: grid; gap: 4px; }
.related-picker__result { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; min-width: 0; }
.related-picker__result:hover { background: var(--rb-soft); }
.related-picker__result--selected { background: var(--rb-selection); }
.related-picker__result > :first-child { flex: 1; min-width: 0; }
.related-picker__result-copy { display: grid; min-width: 0; text-align: left; }
.related-picker__result-title { font-size: 14px; overflow-wrap: anywhere; }
.related-picker__linked { color: var(--rb-muted); font-size: 12px; white-space: nowrap; border: 1px solid var(--rb-border); border-radius: 4px; padding: 1px 5px; }
.related-picker__message { min-height: 160px; display: grid; place-content: center; gap: 8px; text-align: center; color: var(--rb-muted); font-size: 13px; }
.related-picker__pagination > div { display: flex; align-items: center; gap: 4px; }
.related-picker__selection { display: grid; grid-template-rows: 32px minmax(0, 1fr); min-height: 0; border-top: 1px solid var(--rb-border); padding-top: 12px; }
.related-picker__selection-header { min-height: 32px; color: var(--rb-ink); }
.related-picker__chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; }
.related-picker__chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--rb-border); border-radius: 4px; padding-left: 8px; max-width: 100%; font-size: 12px; }
.related-picker__chip > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 200px; }
.related-picker__footer { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.related-picker__footer > span { display: flex; align-items: center; gap: 6px; color: var(--rb-muted); font-size: 12px; }
.related-picker__footer > div { display: flex; gap: 8px; margin-left: auto; }
@media (max-width: 560px) { .related-picker { height: min(560px, calc(88dvh - 176px)); } }
@media (pointer: coarse) { .related-documents__row { min-height: 64px; } }
</style>
