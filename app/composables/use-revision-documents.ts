import { onScopeDispose, shallowReactive } from 'vue'
import type { RevisionDto } from '../../shared/requirements/revisions'

/** 历史快照不可变；每页最多保留六份正文，停用取消请求，淘汰释放缓存。 */
export function useRevisionDocuments(fetchRevision: (id: string, signal: AbortSignal) => Promise<RevisionDto>) {
  const documents = shallowReactive(new Map<string, RevisionDto>())
  const errors = shallowReactive(new Map<string, string>())
  const requests = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  let disposed = false

  function prime(revision: RevisionDto) {
    if (disposed) return
    // 重新读取详情不会改变不可变版本的对象身份，也不让已有 Diff 缓存失效。
    const current = documents.get(revision.id) ?? revision
    documents.delete(revision.id)
    documents.set(revision.id, current)
    errors.delete(revision.id)
    if (documents.size > 6) documents.delete(documents.keys().next().value!)
  }

  function loadOne(id: string): Promise<void> {
    if (disposed || documents.has(id)) return Promise.resolve()
    const pending = requests.get(id)
    if (pending) return pending.promise
    const controller = new AbortController()
    errors.delete(id)
    const promise = Promise.resolve().then(() => fetchRevision(id, controller.signal)).then(revision => {
      if (revision.id !== id) throw new Error('版本响应与请求不匹配')
      if (!controller.signal.aborted) prime(revision)
    }).catch(() => {
      if (!disposed && !controller.signal.aborted) errors.set(id, '版本正文加载失败，请重试。')
    }).finally(() => { if (requests.get(id)?.controller === controller) requests.delete(id) })
    requests.set(id, { controller, promise })
    return promise
  }

  function cancel() {
    requests.forEach(request => request.controller.abort())
    requests.clear()
  }
  onScopeDispose(() => {
    disposed = true
    cancel()
    documents.clear()
    errors.clear()
  })

  return {
    get: (id: string) => documents.get(id) ?? null,
    error: (ids: string[]) => ids.map(id => errors.get(id)).find(Boolean) ?? '',
    prime,
    cancel,
    async load(ids: string[]) { await Promise.all([...new Set(ids.filter(Boolean))].map(loadOne)) },
  }
}
