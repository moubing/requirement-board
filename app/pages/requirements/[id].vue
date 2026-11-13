<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import RequirementDetailWorkspace from '../../components/requirements/RequirementDetailWorkspace.vue'
import RequirementDetailLoading from '../../components/requirements/RequirementDetailLoading.vue'
import { useRequirementCache } from '../../composables/use-requirement-cache'
import type { RequirementDetailMeta, RequirementDto } from '../../types/requirement-detail'

defineOptions({ name: 'RequirementDetailPage' })
definePageMeta({ key: route => String(route.params.id) })
const route = useRoute()
const requirementId = String(route.params.id)
const initialView = route.query.block === undefined && ['history', 'diff'].includes(String(route.query.view ?? '')) ? 'diff' : 'edit'
const index = useRequirementCache()
const active = ref(true)
const initial = shallowRef<{ meta: RequirementDetailMeta; requirement: RequirementDto }>()
// 客户端先提交路由和详情页框架；有效数据齐备后才创建协作工作区。
// SSR 仍等待初始数据，保持直接访问和水合一致。
const [metaRequest, requirementRequest] = await Promise.all([
  useFetch<RequirementDetailMeta>('/api/meta', {
    key: `detail-meta:${index.scope.value}:${requirementId}`, lazy: true, retry: 0, timeout: 15_000,
  }),
  useFetch<RequirementDto>(`/api/requirements/${encodeURIComponent(requirementId)}`, {
    key: `detail-initial:${index.scope.value}:${requirementId}`, lazy: true, retry: 0, timeout: 15_000,
    getCachedData: (key, app) => app.isHydrating ? app.payload.data[key] : undefined,
  }),
])
const pending = computed(() => metaRequest.pending.value || requirementRequest.pending.value)
// 搜索/列表已有目标编号；等待详情时只复用身份摘要，不提前创建正文或协作状态。
const loadingKey = computed(() => initial.value?.requirement.key ?? requirementRequest.data.value?.key ?? index.state.value.summaries[requirementId]?.key ?? '')
const loadError = computed(() => {
  const error = requirementRequest.error.value || metaRequest.error.value
  if (!error) return ''
  return [403, 404].includes(error.statusCode ?? 0)
    ? '文档已删除或暂时无权访问，请返回列表或重新搜索。'
    : '暂时无法加载文档，请检查网络后重试。'
})
watch([metaRequest.data, requirementRequest.data, pending, loadError], ([meta, requirement, loading, error]) => {
  if (active.value && !initial.value && !loading && !error && meta && requirement) initial.value = { meta, requirement }
}, { immediate: true })
watch(requirementRequest.error, error => {
  if (error && [403, 404].includes(error.statusCode ?? 0)) index.invalidate()
})
async function retry() {
  await Promise.all([metaRequest.refresh(), requirementRequest.refresh()])
}
function cancelInitialLoad() {
  if (initial.value) return
  metaRequest.clear()
  requirementRequest.clear()
}
onDeactivated(() => { active.value = false; cancelInitialLoad() })
onActivated(() => {
  if (active.value) return
  active.value = true
  if (!initial.value) void retry()
})
onBeforeUnmount(cancelInitialLoad)
</script>

<template>
  <div class="requirement-detail-route">
    <Suspense :timeout="0">
      <RequirementDetailWorkspace v-if="initial" :initial-meta="initial.meta" :initial-requirement="initial.requirement" />
      <RequirementDetailLoading v-else :requirement-key="loadingKey" :view="initialView" :error="loadError" :pending="pending" @retry="retry" />
      <template #fallback><RequirementDetailLoading :requirement-key="loadingKey" :view="initialView" pending /></template>
    </Suspense>
  </div>
</template>

<style scoped>
.requirement-detail-route { min-width: 0; }
</style>
