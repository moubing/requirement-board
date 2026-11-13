import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useCachedRichTextDiff } from '../../app/composables/use-cached-rich-text-diff'
import type { RichTextDocument } from '../../shared/editor/document'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'

vi.mock('../../shared/diff/rich-text-diff', async importOriginal => {
  const original = await importOriginal<typeof import('../../shared/diff/rich-text-diff')>()
  return { ...original, buildRichTextDiff: vi.fn(original.buildRichTextDiff) }
})
const document = (text: string): RichTextDocument => ({ type: 'doc', content: [
  { type: 'paragraph', attrs: { diffId: 'paragraph' }, content: [{ type: 'text', text }] },
] })

describe('有界比较缓存', () => {
  it('最新版本与正文对象匹配时复用页边核对结果，过期结果不复用', async () => {
    const base = document('旧版'), target = shallowRef(document('当前草稿'))
    const shared = { base, target: target.value, result: buildRichTextDiff(base, target.value) }
    vi.mocked(buildRichTextDiff).mockClear()
    const scope = effectScope()
    const diff = scope.run(() => useCachedRichTextDiff({ active: () => true, base: () => base, target: () => target.value,
      key: () => 'v1:draft', scope: () => 'user:document:0', comparison: () => shared }))!
    expect(diff.value).toBe(shared.result)
    expect(buildRichTextDiff).not.toHaveBeenCalled()
    target.value = document('后来收到的远端草稿')
    await nextTick()
    expect(buildRichTextDiff).toHaveBeenCalledOnce()
    expect(diff.value).not.toBe(shared.result)
    scope.stop()
  })
  it('隐藏期间不计算，激活按最新正文计算一次；纯显隐复用结果', async () => {
    vi.mocked(buildRichTextDiff).mockClear()
    const scope = effectScope(), active = ref(false)
    const base = shallowRef(document('旧版')), target = shallowRef(document('草稿'))
    const diff = scope.run(() => useCachedRichTextDiff({ active: () => active.value, base: () => base.value,
      target: () => target.value, key: () => 'v1:draft', scope: () => 'user:document:0' }))!
    try {
      expect(buildRichTextDiff).not.toHaveBeenCalled()
      active.value = true; await nextTick()
      const first = diff.value
      active.value = false; await nextTick()
      active.value = true; await nextTick()
      expect(diff.value).toBe(first)
      expect(buildRichTextDiff).toHaveBeenCalledTimes(1)
      active.value = false; await nextTick()
      target.value = document('本地编辑'); await nextTick()
      target.value = document('远端编辑'); await nextTick()
      expect(buildRichTextDiff).toHaveBeenCalledTimes(1)
      active.value = true; await nextTick()
      expect(buildRichTextDiff).toHaveBeenCalledTimes(2)
      expect(diff.value).toEqual(buildRichTextDiff(base.value, target.value))
    } finally { scope.stop() }
  })

  it('版本对按最近使用淘汰，账号/文档/代次变化清除旧结果', async () => {
    vi.mocked(buildRichTextDiff).mockClear()
    const scope = effectScope(), key = ref('one'), owner = ref('user:document:0')
    const base = document('旧版'), target = document('新版')
    const diff = scope.run(() => useCachedRichTextDiff({ active: () => true, base: () => base, target: () => target,
      key: () => key.value, scope: () => owner.value }))!
    try {
      const one = diff.value
      key.value = 'two'; await nextTick()
      key.value = 'one'; await nextTick()
      expect(diff.value).toBe(one)
      key.value = 'three'; await nextTick()
      key.value = 'two'; await nextTick()
      expect(buildRichTextDiff).toHaveBeenCalledTimes(4)
      owner.value = 'user:document:1'; await nextTick()
      expect(buildRichTextDiff).toHaveBeenCalledTimes(5)
    } finally { scope.stop() }
  })
})
