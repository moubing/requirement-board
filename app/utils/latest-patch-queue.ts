/** 串行写入、合并尚未发送的选择；处理中和失败的值始终保留，直到确认或显式取消。 */
export function createLatestPatchQueue<T extends object, R>(options: {
  send: (patch: Partial<T>) => Promise<R>
  confirmed: (result: R, patch: Partial<T>) => void
  settled?: (patch: Partial<T>) => void
  failed?: (error: unknown, pending: Partial<T>) => void
  changed: (pending: Partial<T>, active: Partial<T>) => void
}) {
  let pending: Partial<T> = {}
  let active: Partial<T> = {}
  let sequence = 0
  const revisions = new Map<keyof T, number>()
  let request: Promise<void> | undefined
  const keys = (value: Partial<T>) => Object.keys(value) as (keyof T)[]
  const publish = () => options.changed({ ...pending }, { ...active })
  async function drain() {
    try {
      while (keys(pending).length) {
        const submitted = { ...pending }
        const captured = new Map(revisions)
        active = submitted; publish()
        try {
          const result = await options.send(submitted)
          options.confirmed(result, submitted)
          const settled: Partial<T> = {}
          for (const key of keys(submitted)) if (captured.get(key) === revisions.get(key)) {
            settled[key] = submitted[key]; delete pending[key]
          }
          options.settled?.(settled)
        } catch (error) {
          // 新选择已到达时继续发送最终值；没有新输入则停在可重试状态。
          if (!keys(pending).some(key => captured.get(key) !== revisions.get(key))) {
            options.failed?.(error, { ...pending })
            throw error
          }
        }
        active = {}; publish()
      }
    } finally { active = {}; request = undefined; publish() }
  }
  return {
    submit(patch: Partial<T> = {}) {
      for (const key of keys(patch)) { pending[key] = patch[key]; revisions.set(key, ++sequence) }
      publish()
      return request ??= Promise.resolve().then(drain)
    },
    cancel() { if (!request) { pending = {}; publish() } },
  }
}
