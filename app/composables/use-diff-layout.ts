import type { Ref } from 'vue'
import { useActiveVisualEffect } from './use-active-visual-effect'

export function useDiffLayout(container?: Ref<HTMLElement | null>, active: () => boolean = () => true) {
  const compact = ref(false)
  const preferred = ref<'split' | 'unified' | null>(null)
  const layout = computed({
    get: () => preferred.value ?? (compact.value ? 'unified' : 'split'),
    set: (value: string | number) => {
      if (value === 'split' || value === 'unified') preferred.value = value
    },
  })
  let observer: ResizeObserver | undefined
  let frame = 0
  const update = () => {
    if (!active() || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!active()) return
      const width = container ? container.value?.clientWidth ?? 0 : window.innerWidth
      // 隐藏容器的 0 宽不表示窗口布局，保留最后稳定模式。
      if (width > 0) compact.value = width < 860
    })
  }
  useActiveVisualEffect(active, () => {
    update()
    if (container?.value) { observer = new ResizeObserver(update); observer.observe(container.value) }
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); frame = 0; window.removeEventListener('resize', update) }
  })
  return layout
}
