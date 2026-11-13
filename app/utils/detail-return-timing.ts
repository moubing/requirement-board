type TimingWindow = Window & { __RB_DETAIL_RETURN_TIMING__?: boolean }

// 仅由性能验证显式启用；不记录正文、不发送遥测，也不改变恢复流程。
let sequence = 0
let current: ReturnType<typeof createTiming> | undefined
function createTiming(id: string) {
  const run = ++sequence
  const started = performance.now()
  let frame = 0
  let ready = false
  const timing = {
    id,
    point(name: string) { timing.measure(name, performance.now()) },
    measure(name: string, start: number) {
      if (current !== timing) return
      performance.measure(`rb:detail-return:${name}`, { start, end: performance.now(), detail: { run, started } })
    },
    start(name: string) {
      const start = performance.now()
      let ended = false
      return () => { if (!ended) { ended = true; timing.measure(name, start) } }
    },
    editorReady() {
      if (ready || current !== timing) return
      ready = true
      timing.measure('editable', started)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { frame = 0; timing.measure('frames-ready', started) })
      })
    },
    cancel() { cancelAnimationFrame(frame); if (current === timing) current = undefined },
  }
  return timing
}

export function beginDetailReturnTiming(path: string) {
  if (typeof window === 'undefined' || !(window as TimingWindow).__RB_DETAIL_RETURN_TIMING__) return
  current?.cancel()
  const id = /^\/requirements\/([^/]+)\/?$/.exec(path)?.[1]
  if (!id) return
  current = createTiming(id)
  current.point('navigation')
  return current
}

export function detailReturnTiming(id: string | undefined) {
  return id && current?.id === id ? current : undefined
}
