<script setup lang="ts">
import { BingButton } from '@moubing/bing-ui'
import type { PropertyHistoryEntry } from '#shared/requirements/properties'
import { accountError } from '~/utils/account-display'

definePageMeta({ path: '/requirements/:id/property-history', key: route => String(route.params.id) })
const id = String(useRoute().params.id)
type HistoryPage = { items: PropertyHistoryEntry[]; nextCursor: string | null }
const { data, error, refresh } = await useFetch<HistoryPage>(`/api/requirements/${id}/property-history`)
const extra = ref<PropertyHistoryEntry[]>([])
const cursor = ref<string | null | undefined>()
const busy = ref(false)
const moreError = ref('')
const items = computed(() => [...data.value?.items ?? [], ...extra.value])
const nextCursor = computed(() => cursor.value === undefined ? data.value?.nextCursor : cursor.value)
const sources = { web: '网页修改', agent_review: 'AI 审核（历史）', agent_takeover: 'AI 修改', migration: '系统迁移' }
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
async function loadMore() {
  if (!nextCursor.value || busy.value) return
  busy.value = true; moreError.value = ''
  try {
    const page = await $fetch<HistoryPage>(`/api/requirements/${id}/property-history`, { query: { cursor: nextCursor.value } })
    extra.value.push(...page.items); cursor.value = page.nextCursor
  } catch (err) { moreError.value = accountError(err) }
  finally { busy.value = false }
}
async function reload() {
  if (busy.value) return
  busy.value = true; moreError.value = ''
  try { await refresh(); extra.value = []; cursor.value = undefined }
  finally { busy.value = false }
}
useHead({ title: '属性变更记录 · 文档看板' })
</script>

<template>
  <main class="property-history">
    <header><div><NuxtLink :to="`/requirements/${id}`">返回文档 →</NuxtLink><h1>属性变更记录</h1><p>每个属性独立记录，正文历史请在版本比较中查看。</p></div><BingButton variant="secondary" :loading="busy" @click="reload">刷新</BingButton></header>
    <p v-if="error || moreError" role="alert" class="account-error">{{ moreError || accountError(error) }}</p>
    <p v-else-if="!items.length">暂无属性变更记录</p>
    <ol>
      <li v-for="item in items" :key="item.id" :data-operation-id="item.operationId">
        <strong>{{ item.label }}</strong><p>{{ item.before.label }} → {{ item.after.label }}</p>
        <small>{{ item.actor.name }} · {{ sources[item.source] }} · {{ date(item.createdAt) }}</small>
      </li>
    </ol>
    <BingButton v-if="nextCursor" variant="secondary" :loading="busy" @click="loadMore">加载更多</BingButton>
  </main>
</template>

<style scoped>
.property-history { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
header h1 { margin: 16px 0 8px; font-size: 26px; }
header p, small { color: var(--bing-muted); line-height: 1.7; }
ol { list-style: none; padding: 0; margin: 24px 0; }
li { padding: 20px 0; border-bottom: 1px solid var(--bing-border); overflow-wrap: anywhere; }
li p { margin: 8px 0; }
</style>
