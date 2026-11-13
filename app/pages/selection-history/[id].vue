<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useRoute } from '#app'
import { ArrowUpRight, History } from 'lucide-vue-next'
import { BingButton, BingIcon } from '@moubing/bing-ui'

import SelectionHistoryWorkspace from '../../components/diff/SelectionHistoryWorkspace.vue'
import {
  readSelectionHistoryTabContext,
  type ReadSelectionHistoryTabContextResult,
  type SelectionHistoryTabContext,
} from '../../components/diff/selection-history-tab-context'
import type { SelectionHistoryVersion } from '~~/shared/diff/selection-history'
import type { RevisionDto } from '#shared/requirements/revisions'

interface RequirementDto {
  id: string
  key: string
  title: string
}

const route = useRoute()
const requirementId = computed(() => String(route.params.id))
const requirementPath = computed(() => `/requirements/${encodeURIComponent(requirementId.value)}`)
const contextToken = computed(() => routeQueryString(route.query.context))
const tabContext = ref<SelectionHistoryTabContext | null>(null)
const contextError = ref('')
const contextLoaded = ref(false)
const draftTargetId = 'draft_current'

const {
  data: requirement,
  error: requirementError,
  pending: loadingRequirement,
} = await useFetch<RequirementDto>(() => `/api/requirements/${requirementId.value}`)
const {
  data: revisions,
  error: revisionsError,
  pending: loadingRevisions,
  execute: loadRevisions,
} = await useFetch<RevisionDto[]>(() => `/api/requirements/${requirementId.value}/revisions`, {
  query: { includeContent: 'true' }, server: false, immediate: false,
})

const selectionHistoryPageTitle = computed(() => {
  const identity = [requirement.value?.key, requirement.value?.title]
    .filter(Boolean)
    .join(' · ')

  return ['选区历史记录', identity, '文档看板'].filter(Boolean).join(' · ')
})

useHead({ title: selectionHistoryPageTitle })

const versions = computed<SelectionHistoryVersion[]>(() => {
  if (!tabContext.value) return []

  return [
    {
      id: draftTargetId,
      label: '当前草稿（打开时）',
      version: null,
      document: tabContext.value.draftDocument,
      author: tabContext.value.currentUserName,
      changeNote: '打开选区历史时的未保存内容',
      createdAt: tabContext.value.capturedAt,
      draft: true,
      attribution: tabContext.value.attribution,
    },
    ...(revisions.value ?? [])
      .slice()
      .sort((left, right) => right.version - left.version)
      .map((revision) => ({
        id: revision.id,
        label: `v${revision.version}`,
        version: revision.version,
        document: revision.contentJson,
        createdAt: revision.createdAt,
        author: revision.author.name,
        changeNote: revision.changeNote,
        attribution: revision.attribution,
        attributionSequence: revision.attributionSequence,
      })),
  ]
})

const loading = computed(() =>
  !contextLoaded.value || loadingRequirement.value || loadingRevisions.value,
)
const pageError = computed(() => {
  if (contextError.value) return contextError.value
  if (requirementError.value || revisionsError.value) return '选区历史数据加载失败，请返回文档页后重试。'
  return ''
})

onMounted(async () => {
  if (!contextToken.value) {
    contextError.value = '缺少选区上下文，请返回文档页重新选择内容。'
    contextLoaded.value = true
    return
  }

  try {
    const result = readSelectionHistoryTabContext(
      window.localStorage,
      window.sessionStorage,
      contextToken.value,
      requirementId.value,
    )

    if (result.ok) {
      tabContext.value = result.context
      await loadRevisions()
    } else {
      contextError.value = contextErrorMessage(result)
    }
  } catch {
    contextError.value = '浏览器无法读取选区上下文，请返回文档页重新打开。'
  } finally {
    contextLoaded.value = true
  }
})

function openRevision(revisionId: string) {
  if (!(revisions.value ?? []).some((revision) => revision.id === revisionId)) return
  void navigateTo({
    path: `/requirements/${encodeURIComponent(requirementId.value)}`,
    query: { view: 'diff', revision: revisionId },
  })
}

function returnToRequirement() {
  void navigateTo(requirementPath.value)
}

function routeQueryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function contextErrorMessage(result: Exclude<ReadSelectionHistoryTabContextResult, { ok: true }>) {
  if (result.reason === 'expired') return '这份选区历史上下文已经过期，请返回文档页重新打开。'
  if (result.reason === 'requirement-mismatch') return '选区上下文与当前文档不匹配，请返回文档页重试。'
  if (result.reason === 'invalid') return '选区上下文已损坏，请返回文档页重新打开。'
  return '找不到这份选区上下文。它可能来自另一个标签页，请返回文档页重新打开。'
}
</script>

<template>
  <main class="selection-history-page">
    <header class="selection-history-page__header">
      <span class="selection-history-page__icon" aria-hidden="true"><BingIcon :icon="History" :size="22" decorative /></span>
      <div class="selection-history-page__heading">
        <h1>选区历史记录</h1>
        <NuxtLink
          class="selection-history-page__requirement-link"
          :to="requirementPath"
          :title="`返回文档：${requirement?.title ?? '文档正文'}`"
        >
          <span v-if="requirement?.key" class="selection-history-page__key">{{ requirement.key }}</span>
          <span class="selection-history-page__requirement-title">{{ requirement?.title ?? '文档正文' }}</span>
          <BingIcon :icon="ArrowUpRight" :size="13" decorative />
        </NuxtLink>
      </div>
    </header>

    <section v-if="loading" class="selection-history-page__state" aria-live="polite">
      正在加载选区历史…
    </section>

    <section v-else-if="pageError" class="selection-history-page__state selection-history-page__state--error">
      <p>{{ pageError }}</p>
      <BingButton size="sm" rounded="sm" @click="returnToRequirement">返回文档页</BingButton>
    </section>

    <ClientOnly v-else-if="tabContext">
      <SelectionHistoryWorkspace
        :anchor="tabContext.anchor"
        :versions="versions"
        :requirement-id="requirementId"
        :attribution-pending="tabContext.attributionPending"
        @open-revision="openRevision"
      />
    </ClientOnly>
  </main>
</template>
