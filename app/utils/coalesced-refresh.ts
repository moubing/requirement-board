/** 合并同一轮通知；请求途中到达的变更在完成后补读，不取消正在进行的请求。 */
export function createCoalescedRefresh<Key>(refresh: (keys: Key[]) => Promise<unknown>) {
  const pending = new Set<Key>()
  let running: Promise<void> | undefined
  let disposed = false
  return {
    request(keys: Key[]) {
      if (disposed) return Promise.resolve()
      keys.forEach(key => pending.add(key))
      running ??= Promise.resolve().then(async () => {
        try {
          while (!disposed && pending.size) {
            const batch = [...pending]
            pending.clear()
            await refresh(batch)
          }
        } finally { running = undefined }
      })
      return running
    },
    dispose() { disposed = true; pending.clear() },
  }
}
