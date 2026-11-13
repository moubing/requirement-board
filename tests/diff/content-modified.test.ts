import { effectScope, ref, shallowRef } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useContentModified } from '../../app/composables/use-content-modified'
import type { RichTextDocument } from '../../shared/editor/document'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('正文版本核对调度', () => {
  it('分片被新正文或停用打断后，不发布旧代次的结果', async () => {
    vi.useFakeTimers()
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock += 7)
    const base: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p' } }] }
    const active = ref(true)
    const content = shallowRef<RichTextDocument>({ type: 'doc', get content() { throw new Error('过期正文不应继续计算') } })
    const scope = effectScope()
    const state = scope.run(() => useContentModified(content, shallowRef(base), ref(true), { active: () => active.value, markers: () => true }))!
    await vi.advanceTimersByTimeAsync(200)
    expect(clock).toBeGreaterThan(0)
    expect(state.comparison.value).toBeNull()
    active.value = false
    content.value = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p' }, content: [{ type: 'text', text: '最新正文' }] }] }
    await vi.advanceTimersByTimeAsync(2000)
    expect(state.comparison.value).toBeNull()
    active.value = true
    await vi.advanceTimersByTimeAsync(300)
    expect(state.comparison.value?.target).toBe(content.value)
    expect(state.markers.value[0]?.pairs[0]?.target?.text).toBe('最新正文')
    scope.stop()
  })
  it('停用取消计算，恢复只核对最新值；关闭标记保留轻量修改提示', async () => {
    vi.useFakeTimers()
    const base: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p' } }] }
    const content = shallowRef(base), saved = shallowRef<RichTextDocument | null>(base)
    const active = ref(true), enabled = ref(true)
    const scope = effectScope()
    const state = scope.run(() => useContentModified(content, saved, ref(true), { active: () => active.value, markers: () => enabled.value }))!
    await vi.advanceTimersByTimeAsync(200)
    expect(state.modified.value).toBe(false)
    active.value = false
    let visits = 0
    content.value = { type: 'doc', get content() { visits++; return [{ type: 'paragraph', attrs: { diffId: 'p' }, content: [{ type: 'text', text: '最新' }] }] } }
    await vi.advanceTimersByTimeAsync(2000)
    expect(visits).toBe(0)
    active.value = true
    await vi.advanceTimersByTimeAsync(200)
    expect(state.modified.value).toBe(true)
    expect(state.markers.value).toHaveLength(1)
    expect(state.markers.value[0]!.pairs[0]).toBe(state.comparison.value!.result.pairs[0])
    enabled.value = false
    expect(state.comparison.value).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(state.modified.value).toBe(true)
    expect(state.markers.value).toEqual([])
    saved.value = content.value
    enabled.value = true
    await vi.advanceTimersByTimeAsync(200)
    expect(state.markers.value).toEqual([])
    scope.stop()
  })
  it('连续输入保持待核对，截止期限核对最新代次，撤销最终恢复一致', async () => {
    vi.useFakeTimers()
    const baseline: RichTextDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p' } }] }
    const content = shallowRef(baseline)
    const saved = shallowRef<RichTextDocument | null>(baseline)
    const ready = ref(true)
    const scope = effectScope()
    const { modified } = scope.run(() => useContentModified(content, saved, ready))!
    await vi.advanceTimersByTimeAsync(200)
    expect(modified.value).toBe(false)
    let traversals = 0
    for (let i = 0; i < 15; i++) {
      content.value = { type: 'doc', get content() { traversals++; return [{ type: 'paragraph', content: [{ type: 'text', text: String(i) }] }] } }
      expect(modified.value).toBe(null)
      expect(traversals).toBe(0)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(traversals).toBeGreaterThan(0)
    expect(modified.value).toBe(true)
    content.value = { ...baseline, content: [{ type: 'paragraph', attrs: { diffId: 'new-id' } }] }
    await vi.advanceTimersByTimeAsync(200)
    expect(modified.value).toBe(false)
    ready.value = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(modified.value).toBe(null)
    scope.stop()
  })
})
