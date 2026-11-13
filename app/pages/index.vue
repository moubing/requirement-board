<script setup lang="ts">
import { BingButton, BingIcon } from '@moubing/bing-ui'
import { Clock3, UserCheck } from 'lucide-vue-next'
import { computed, onMounted, onServerPrefetch } from 'vue'
import { useBoardMeta } from '~/composables/use-board-meta'
import { useRequirementQuery } from '~/composables/use-requirement-query'
import { useWorkbenchFlow } from '~/composables/use-workbench-flow'
import { requirementListLink } from '~/utils/requirement-list-link'
import type { CompletionScope, WorkbenchCompletions, WorkbenchTeamLoad } from '#shared/workbench/home'
import WorkflowBoard from '~/components/workbench/WorkflowBoard.vue'
import ProjectActivity from '~/components/workbench/ProjectActivity.vue'
import TeamLoad from '~/components/workbench/TeamLoad.vue'
import CompletionRhythm from '~/components/workbench/CompletionRhythm.vue'

// 岛屿布局：灰色底上四块圆角面板。第一屏是我的工作流和项目动态，往下是团队负载与完成节奏；各区块独立加载和重试。
useHead({ title: '工作台 · 文档看板' })
const metadata = useBoardMeta()
const meta = metadata.data
const request = useRequestFetch()
const flow = useWorkbenchFlow()
const team = useRequirementQuery({ key: 'workbench:team-load', initial: {},
  fetch: async (query, signal) => ({ data: await request<WorkbenchTeamLoad>('/api/workbench/team-load', { signal, retry: 0, timeout: 10_000 }), query }) })
const completions = useRequirementQuery({ key: 'workbench:completions', initial: { scope: 'team' } as { scope: CompletionScope },
  fetch: async (query, signal) => ({ data: await request<WorkbenchCompletions>('/api/workbench/completions', { query, signal, retry: 0, timeout: 10_000 }), query }) })
async function load() { await Promise.all([metadata.refresh(), flow.query.load(), team.load(), completions.load()]) }
onServerPrefetch(load); onMounted(load)

const access = useAccountAccessState()
const canManageMembers = computed(() => access.value?.user.role === 'admin' || access.value?.projectRoles.includes('project_admin'))
const flowData = flow.data
const verify = computed(() => flow.counts.value?.verify ?? 0)
const stale = computed(() => flow.counts.value?.stale ?? 0)
const verifyTo = computed(() => requirementListLink({ reporter: 'me', statusId: flowData.value?.statuses.testing.id }))
const staleTo = requirementListLink({ assignee: 'me', stale: '1' })
</script>

<template>
  <main class="workspace-page desk-page">
    <h1 class="visually-hidden">工作台</h1>
    <div class="desk">
      <section class="desk-island desk-island--flow" aria-labelledby="desk-flow-title">
        <header class="desk-island__head">
          <h2 id="desk-flow-title">我的工作</h2>
          <div v-if="verify || stale" class="desk-focus">
            <NuxtLink v-if="verify" :to="verifyTo" class="desk-focus__chip is-verify" :aria-label="`${verify} 条等你验证，查看列表`">
              <BingIcon :icon="UserCheck" :size="14" decorative />等你验证<b>{{ verify }}</b>
            </NuxtLink>
            <NuxtLink v-if="stale" :to="staleTo" class="desk-focus__chip is-stale" :aria-label="`${stale} 条停滞，查看列表`">
              <BingIcon :icon="Clock3" :size="14" decorative />停滞<b>{{ stale }}</b>
            </NuxtLink>
          </div>
        </header>
        <div class="desk-island__body desk__board" :aria-busy="flow.query.pending.value">
          <div v-if="flow.query.error.value" class="workspace-feedback" role="alert">
            <span>我的工作流{{ flowData ? '更新失败，显示上次成功结果。' : '暂时无法加载。' }}</span>
            <BingButton size="sm" variant="secondary" :loading="flow.query.pending.value" @click="flow.query.retry">重试</BingButton>
          </div>
          <WorkflowBoard v-if="flowData && flow.counts.value" :flow="flowData" :cards="flow.cards.value" :counts="flow.counts.value"
            :pending-ids="flow.pendingIds.value" :flash="flow.flash.value" @move="flow.move" />
          <p v-else-if="!flow.query.error.value" class="workspace-empty" role="status">正在加载…</p>
        </div>
      </section>

      <aside class="desk-island desk-island--activity" aria-labelledby="desk-activity-title">
        <header class="desk-island__head"><h2 id="desk-activity-title">项目动态</h2></header>
        <ProjectActivity class="desk-island__body desk__activity" max-height="var(--desk-activity-height)" />
      </aside>

      <section class="desk-island desk-island--load" role="region" aria-labelledby="desk-load-title">
        <header class="desk-island__head">
          <h2 id="desk-load-title">负载</h2>
          <NuxtLink v-if="canManageMembers" to="/members" class="workspace-text-link">管理</NuxtLink>
        </header>
        <div class="desk-island__body">
          <div v-if="team.error.value" class="workspace-feedback" role="alert">
            <span>团队负载{{ team.data.value ? '更新失败，显示上次成功结果。' : '暂时无法加载。' }}</span>
            <BingButton size="sm" variant="secondary" :loading="team.pending.value" @click="team.retry">重试</BingButton>
          </div>
          <TeamLoad v-if="team.data.value" :data="team.data.value" :current-user-id="meta?.currentUserId ?? null" />
          <p v-else class="workspace-empty" role="status">{{ team.error.value ? '' : '正在加载…' }}</p>
        </div>
      </section>

      <section class="desk-island desk-island--rhythm" role="region" aria-labelledby="desk-rhythm-title">
        <header class="desk-island__head"><h2 id="desk-rhythm-title">完成节奏</h2></header>
        <div class="desk-island__body">
          <div v-if="completions.error.value" class="workspace-feedback" role="alert">
            <span>完成节奏{{ completions.data.value ? '更新失败，显示上次成功结果。' : '暂时无法加载。' }}</span>
            <BingButton size="sm" variant="secondary" :loading="completions.pending.value" @click="completions.retry">重试</BingButton>
          </div>
          <CompletionRhythm v-if="completions.data.value" :data="completions.data.value" :scope="completions.query.value.scope" :pending="completions.pending.value"
            @scope="scope => completions.load({ scope })" />
          <p v-else class="workspace-empty" role="status">{{ completions.error.value ? '' : '正在加载…' }}</p>
        </div>
      </section>
    </div>
  </main>
</template>
