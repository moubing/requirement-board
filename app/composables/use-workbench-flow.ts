import { computed, ref } from 'vue'
import { bingToast } from '@moubing/bing-ui'
import { draftError } from '#shared/drafts/document'
import { FLOW_STATES, staleLevel, type FlowState, type TaskFlowState, type WorkbenchFlow, type WorkbenchFlowCard } from '#shared/workbench/home'
import { useRequirementCache } from './use-requirement-cache'
import { useRequirementQuery } from './use-requirement-query'

type Override = { code: TaskFlowState; state: 'pending' | 'confirmed' }
export const WORKBENCH_MOVE_TOAST = 'workbench-move'

function failure(cause: unknown) {
  const status = (cause as { statusCode?: number }).statusCode
  const reason = draftError(cause)
  if (status === 423) return `${reason || 'Agent 正在编辑这篇文档'}，稍后再试`
  if (status === 409 || status === 403 || status === 404) return reason
  return status && status < 500 && reason ? reason : '网络或服务暂时不可用，请重试'
}

/**
 * 首页工作流：拖拽和菜单先移动卡片再提交，请求中的卡片不能再次移动；
 * 成功后提示可撤销最近一次修改，并让工作流、负载和完成节奏一起重新读取。
 * 提交与撤销都携带提交前看到的状态，状态已被他人修改时服务端返回 409，不覆盖。
 */
export function useWorkbenchFlow() {
  const request = useRequestFetch()
  const cache = useRequirementCache()
  const overrides = ref<Record<string, Override>>({})
  const flash = ref<Record<string, 'moved' | 'failed'>>({})
  const query = useRequirementQuery({ key: 'workbench:flow', initial: {},
    fetch: async (value, signal) => ({ data: await request<WorkbenchFlow>('/api/workbench/flow', { signal, retry: 0, timeout: 10_000 }), query: value }),
    // 新结果已经包含确认过的修改；仍在提交的保持移动后的位置。
    receive: () => { overrides.value = Object.fromEntries(Object.entries(overrides.value).filter(([, item]) => item.state === 'pending')) },
  })
  const data = query.data
  const codeOf = (card: WorkbenchFlowCard) => overrides.value[card.id]?.code ?? card.status.code as TaskFlowState
  const cards = computed(() => (data.value?.cards ?? []).map(card => {
    const code = codeOf(card)
    // 改状态就是一次有效活动，移动后的卡片不再显示停滞。
    return code === card.status.code ? card : { ...card, status: data.value!.statuses[code], lastActivityAt: data.value!.asOf,
      verify: card.reporter.id === data.value!.me.id && code === 'testing' }
  }).filter(card => (FLOW_STATES as readonly string[]).includes(card.status.code)))
  /** 列头数量随卡片即时变化；成功后以服务端重新统计为准。 */
  const counts = computed(() => {
    if (!data.value) return null
    const result = { ...data.value.counts }
    for (const card of data.value.cards) {
      const from = card.status.code as FlowState, to = codeOf(card)
      if (from === to) continue
      if (card.mine) {
        result[from]--
        if ((FLOW_STATES as readonly string[]).includes(to)) result[to as FlowState]++
        if (staleLevel(from, card.lastActivityAt, data.value.asOf)) result.stale--
      }
      const reporter = card.reporter.id === data.value.me.id
      result.verify += Number(reporter && to === 'testing') - Number(reporter && from === 'testing')
    }
    return result
  })
  const pendingIds = computed(() => Object.entries(overrides.value).filter(([, item]) => item.state === 'pending').map(([id]) => id))

  function mark(id: string, kind: 'moved' | 'failed') {
    flash.value = { ...flash.value, [id]: kind }
    setTimeout(() => { if (flash.value[id] === kind) { const { [id]: _, ...rest } = flash.value; flash.value = rest } }, 900)
  }
  function set(id: string, value: Override | undefined) {
    const { [id]: _, ...rest } = overrides.value
    overrides.value = value ? { ...rest, [id]: value } : rest
  }
  async function patch(card: WorkbenchFlowCard, from: TaskFlowState, to: TaskFlowState) {
    const statuses = data.value!.statuses
    await $fetch<unknown>(`/api/requirements/${card.id}`, { method: 'PATCH', retry: 0, timeout: 15_000,
      body: { statusId: statuses[to].id, expectedStatusId: statuses[from].id } })
  }

  async function move(card: WorkbenchFlowCard, to: TaskFlowState) {
    const from = codeOf(card)
    if (!data.value || from === to || pendingIds.value.includes(card.id)) return
    const scope = cache.scope.value, statuses = data.value.statuses
    set(card.id, { code: to, state: 'pending' })
    try {
      await patch(card, from, to)
      if (scope !== cache.scope.value) return
      set(card.id, { code: to, state: 'confirmed' })
      mark(card.id, 'moved')
      // 同一个提示复用：连续操作只保留最近一次的撤销。
      bingToast.success({ id: WORKBENCH_MOVE_TOAST, position: 'top-center', message: `已将 ${card.key} 改为${statuses[to].name}`,
        action: { label: '撤销', ariaLabel: `撤销 ${card.key} 的状态修改`, onClick: () => undo(card, from, to) } })
    } catch (cause) {
      if (scope !== cache.scope.value) return
      set(card.id, undefined)
      mark(card.id, 'failed')
      bingToast.error({ id: WORKBENCH_MOVE_TOAST, position: 'top-center', duration: 6500, message: `${card.key} 未能改为${statuses[to].name}：${failure(cause)}` })
    } finally {
      if (scope === cache.scope.value) cache.invalidate()
    }
  }

  async function undo(card: WorkbenchFlowCard, from: TaskFlowState, to: TaskFlowState) {
    if (!data.value || pendingIds.value.includes(card.id)) throw new Error('pending')
    const scope = cache.scope.value, statuses = data.value.statuses
    set(card.id, { code: from, state: 'pending' })
    try {
      await patch(card, to, from)
      if (scope !== cache.scope.value) return
      set(card.id, { code: from, state: 'confirmed' })
      mark(card.id, 'moved')
      bingToast.success({ id: `${WORKBENCH_MOVE_TOAST}-undo`, position: 'top-center', message: `已撤销，${card.key} 恢复为${statuses[from].name}` })
    } catch (cause) {
      if (scope !== cache.scope.value) return
      set(card.id, { code: to, state: 'confirmed' })
      mark(card.id, 'failed')
      bingToast.error({ id: `${WORKBENCH_MOVE_TOAST}-undo`, position: 'top-center', duration: 6500, message: `撤销失败：${failure(cause)}` })
      // 拒绝时保留撤销提示；状态已被他人修改时重试也会失败，但仍由用户决定是否关闭。
      throw cause
    } finally {
      if (scope === cache.scope.value) cache.invalidate()
    }
  }

  return { query, data, cards, counts, pendingIds, flash, move, codeOf }
}
