// 保存确认使用整篇文档的签名，但不应在每次字符或远端事务中立即计算。
export function createCollaborationSignatureTracker(
  compute: () => Promise<string>,
  publish: (signature: string) => void,
  delay = 200,
) {
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let computedGeneration = -1
  let flight: { generation: number; promise: Promise<void> } | undefined

  function refresh(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    if (disposed || computedGeneration === generation) return Promise.resolve()
    if (flight?.generation === generation) return flight.promise
    const request = generation
    const promise = compute().then(signature => {
      if (!disposed && request === generation) { computedGeneration = request; publish(signature) }
    }).catch(() => {
      if (!disposed && request === generation) publish('')
    }).finally(() => { if (flight?.promise === promise) flight = undefined })
    flight = { generation: request, promise }
    return promise
  }

  function schedule() {
    if (disposed || timer || computedGeneration === generation || flight?.generation === generation) return
    timer = setTimeout(() => void refresh(), delay)
  }

  function changed() {
    if (disposed) return
    generation++
    publish('')
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), delay)
  }

  function destroy() {
    disposed = true
    generation++
    clearTimeout(timer)
    timer = undefined
  }

  return { changed, refresh, schedule, destroy }
}
