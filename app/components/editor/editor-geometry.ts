type Measurement = () => (() => void) | void
const queues = new WeakMap<HTMLElement, { frame: number; tasks: Map<object, Measurement> }>()

/** 同一正文帧先收集几何，再提交滚动/响应式状态；隐藏与卸载可按调用方取消。 */
export function scheduleEditorGeometry(root: HTMLElement, owner: object, measure: Measurement) {
  let queue = queues.get(root)
  if (!queue) { queue = { frame: 0, tasks: new Map() }; queues.set(root, queue) }
  queue.tasks.set(owner, measure)
  if (queue.frame) return
  const current = queue
  current.frame = window.requestAnimationFrame(() => {
    current.frame = 0
    const tasks = [...current.tasks.entries()]
    const writes: (() => void)[] = []
    for (const [key, task] of tasks) {
      if (current.tasks.get(key) !== task) continue
      current.tasks.delete(key)
      const write = task()
      if (write) writes.push(write)
    }
    writes.forEach(write => write())
  })
}

export function cancelEditorGeometry(root: HTMLElement, owner: object) {
  const queue = queues.get(root)
  if (!queue) return
  queue.tasks.delete(owner)
  if (!queue.tasks.size) { window.cancelAnimationFrame(queue.frame); queue.frame = 0 }
}
