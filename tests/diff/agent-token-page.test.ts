import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'
import { useAgentTokenPage } from '../../app/composables/use-agent-token-page'
import { agentTokenQuerySchema, agentTokenStatus, type AgentTokenPage, type AgentTokenQuery } from '../../shared/agent/tokens'

const result = (query: AgentTokenQuery, total = 23): AgentTokenPage => ({
  items: [], total, page: query.page, limit: query.limit, activeCount: 4, asOf: '2026-10-18T00:00:00.000Z',
})
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('凭证分页', () => {
  it('严格验证分页和状态，撤销优先于到期且到期时间相等即失效', () => {
    expect(agentTokenQuerySchema.parse({})).toEqual({ page: 1, limit: 10, status: 'all' })
    for (const input of [{ page: 0 }, { limit: 101 }, { limit: '1.5' }, { status: 'unknown' }, { page: ['1', '2'] },
      { userId: 'someone' }, { page: Number.MAX_SAFE_INTEGER, limit: 100 }]) {
      expect(agentTokenQuerySchema.safeParse(input).success).toBe(false)
    }
    const now = '2026-10-18T00:00:00.000Z'
    expect(agentTokenStatus({ revokedAt: now, expiresAt: now }, now)).toBe('revoked')
    expect(agentTokenStatus({ revokedAt: null, expiresAt: now }, now)).toBe('expired')
    expect(agentTokenStatus({ revokedAt: null, expiresAt: '2026-10-18T00:00:00.001Z' }, now)).toBe('active')
  })

  it('失败保留已提交页面与计数，重试仍请求失败目标，不将旧数据标成新页', async () => {
    const scope = effectScope(), calls: AgentTokenQuery[] = []
    let fail = false
    const state = scope.run(() => useAgentTokenPage(async query => {
      calls.push({ ...query })
      if (fail) throw new Error('连接失败')
      return result(query)
    }))!
    try {
      await state.load()
      fail = true
      await state.load({ page: 2, limit: 10, status: 'active' })
      expect(state.committedQuery.value).toEqual({ page: 1, limit: 10, status: 'active' })
      expect(state.data.value).toMatchObject({ page: 1, activeCount: 4 })
      expect(state.error.value).toBeInstanceOf(Error)
      fail = false
      await state.retry()
      expect(calls).toContainEqual({ page: 2, limit: 10, status: 'active' })
      expect(state.data.value?.page).toBe(2)
      expect(state.error.value).toBeNull()
    } finally { scope.stop() }
  })

  it('最新条件胜出，迟到的成功或失败不覆盖新响应，卸载取消请求', async () => {
    const scope = effectScope(), calls: { query: AgentTokenQuery; signal: AbortSignal; response: ReturnType<typeof deferred<AgentTokenPage>> }[] = []
    let defer = true
    const state = scope.run(() => useAgentTokenPage((query, signal) => {
      if (!defer) return Promise.resolve(result(query))
      const response = deferred<AgentTokenPage>()
      calls.push({ query, signal, response })
      return response.promise
    }))!
    const first = state.load()
    const second = state.load({ page: 1, limit: 10, status: 'expired' })
    defer = false
    expect(calls[0]!.signal.aborted).toBe(true)
    calls[1]!.response.resolve(result(calls[1]!.query, 7))
    await second
    calls[0]!.response.reject(new Error('旧请求'))
    await first
    expect(state.committedQuery.value.status).toBe('expired')
    expect(state.error.value).toBeNull()
    defer = true
    const third = state.load()
    scope.stop()
    expect(calls[2]!.signal.aborted).toBe(true)
    calls[2]!.response.resolve(result(calls[2]!.query, 99))
    await third
    expect(state.data.value?.total).toBe(7)
  })

  it('越界只补查一次最后有效页，零条回第一页，连续数据变化不形成请求循环', async () => {
    const scope = effectScope(), calls: number[] = []
    const state = scope.run(() => useAgentTokenPage(async query => {
      if (query.status !== 'expired') return result(query, 0)
      calls.push(query.page)
      return result(query, calls.length === 1 ? 11 : 0)
    }))!
    try {
      await state.load({ page: 4, limit: 10, status: 'expired' })
      expect(calls).toEqual([4, 2])
      expect(state.data.value?.total).toBe(0)
      expect(state.data.value?.page).toBe(1)
      await state.load({ page: 4, limit: 10, status: 'expired' })
      expect(calls.slice(2)).toEqual([4, 1])
      expect(state.data.value?.page).toBe(1)
    } finally { scope.stop() }
  })

  it('状态数量取完整总数，仅取十个有效凭证检查到期；摘要失败时不混用新旧数据', async () => {
    const scope = effectScope(), calls: AgentTokenQuery[] = []
    let failSummary = false
    const state = scope.run(() => useAgentTokenPage(async query => {
      calls.push(query)
      if (failSummary && query.status === 'revoked') throw new Error('摘要不可用')
      return result(query, { active: 2, expired: 253, revoked: 42, all: 297 }[query.status])
    }))!
    try {
      await state.load()
      expect(state.overview.value?.counts).toEqual({ active: 2, expired: 253, revoked: 42 })
      expect(calls).toEqual([{ status: 'active', page: 1, limit: 10 }, { status: 'expired', page: 1, limit: 1 }, { status: 'revoked', page: 1, limit: 1 }])
      const previous = state.data.value, summary = state.overview.value
      failSummary = true
      await state.load({ status: 'expired', page: 2, limit: 10 })
      expect(state.data.value).toBe(previous)
      expect(state.overview.value).toBe(summary)
      expect(state.committedQuery.value.status).toBe('active')
      failSummary = false
      await state.retry()
      expect(state.data.value).toMatchObject({ total: 253, page: 2 })
      expect(state.committedQuery.value.status).toBe('expired')
    } finally { scope.stop() }
  })
})
