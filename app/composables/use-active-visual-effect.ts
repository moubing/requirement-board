import { onBeforeUnmount, onMounted, watch } from 'vue'

/** 视觉资源只在可见期间注册；持久化、上传和协作不属于此生命周期。 */
export function useActiveVisualEffect(active: () => boolean, start: () => (() => void)) {
  let mounted = false
  let cleanup: (() => void) | undefined
  function update() {
    cleanup?.()
    cleanup = mounted && active() ? start() : undefined
  }
  watch(active, update, { flush: 'post' })
  onMounted(() => { mounted = true; update() })
  onBeforeUnmount(() => { mounted = false; cleanup?.(); cleanup = undefined })
}
