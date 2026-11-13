import { computed, effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useRevisionDocuments } from '../../app/composables/use-revision-documents'
import type { RevisionDto } from '../../shared/requirements/revisions'

const revision = (id: string): RevisionDto => ({ id, requirementId: 'req', version: 1, title: id,
  contentJson: { type: 'doc', content: [] }, contentText: '', changeNote: '', createdAt: '2026-10-05T00:00:00Z',
  author: { id: 'user', name: '成员', avatarColor: '#000000' } })

describe('按需读取版本正文', () => {
  it('不可变正文保持对象身份，六份上限；停用取消后可以重新加载', async () => {
    const scope = effectScope()
    const cache = scope.run(() => useRevisionDocuments(async id => revision(id)))!
    try {
      const original = revision('latest')
      cache.prime(original); cache.prime(revision('latest'))
      expect(cache.get('latest')).toBe(original)
      for (let i = 0; i < 6; i++) cache.prime(revision(String(i)))
      expect(cache.get('latest')).toBeNull()
      const cancelled = cache.load(['old'])
      cache.cancel()
      await cancelled
      expect(cache.get('old')).toBeNull()
      await cache.load(['old'])
      expect(cache.get('old')?.id).toBe('old')
    } finally { scope.stop() }
  })

  it('复用详情中的最新版本，并合并同一历史版本的并发请求', async () => {
    const fetch = vi.fn(async (id: string) => revision(id))
    const scope = effectScope()
    const cache = scope.run(() => useRevisionDocuments(fetch))!
    try {
      cache.prime(revision('latest'))
      await Promise.all([cache.load(['latest', 'old', 'old']), cache.load(['old'])])
      expect(fetch.mock.calls.map(([id]) => id)).toEqual(['old'])
      await cache.load(['old'])
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { scope.stop() }
  })

  it('快速切换后，较迟返回的旧请求不会覆盖当前选择', async () => {
    const replies = new Map<string, (value: RevisionDto) => void>()
    const scope = effectScope()
    const cache = scope.run(() => useRevisionDocuments(id => new Promise(resolve => replies.set(id, resolve))))!
    const selected = ref('one')
    const current = computed(() => cache.get(selected.value))
    try {
      const first = cache.load(['one'])
      selected.value = 'two'
      const second = cache.load(['two'])
      await Promise.resolve()
      replies.get('two')!(revision('two'))
      await second
      expect(current.value?.id).toBe('two')
      replies.get('one')!(revision('one'))
      await first
      expect(current.value?.id).toBe('two')
      selected.value = 'one'
      expect(current.value?.id).toBe('one')
    } finally { scope.stop() }
  })

  it('失败可重试，响应 ID 不匹配不能成为有效缓存', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('断网')).mockResolvedValueOnce(revision('wrong')).mockResolvedValue(revision('one'))
    const scope = effectScope()
    const cache = scope.run(() => useRevisionDocuments(fetch))!
    try {
      await cache.load(['one'])
      expect(cache.error(['one'])).toContain('加载失败')
      await cache.load(['one'])
      expect(cache.get('one')).toBeNull()
      expect(cache.get('wrong')).toBeNull()
      await cache.load(['one'])
      expect(cache.error(['one'])).toBe('')
      expect(cache.get('one')?.id).toBe('one')
    } finally { scope.stop() }
  })

  it('页面销毁后中止请求，迟到的响应不再保留正文', async () => {
    let reply!: (value: RevisionDto) => void
    let signal!: AbortSignal
    const scope = effectScope()
    const cache = scope.run(() => useRevisionDocuments((_id, currentSignal) => {
      signal = currentSignal
      return new Promise(resolve => { reply = resolve })
    }))!
    const request = cache.load(['one'])
    await Promise.resolve()
    scope.stop()
    expect(signal.aborted).toBe(true)
    reply(revision('one'))
    await request
    expect(cache.get('one')).toBeNull()
    expect(cache.error(['one'])).toBe('')
  })
})
