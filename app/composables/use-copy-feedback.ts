import { onScopeDispose, ref } from 'vue'

/** 只保留按钮状态，不缓存剪贴板内容（可能是一次性凭证）。 */
export function useCopyFeedback() {
  const copied = ref<string[]>([])
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false
  function markCopied(key: string) {
    if (disposed) return
    clearTimeout(timers.get(key))
    if (!copied.value.includes(key)) copied.value = [...copied.value, key]
    timers.set(key, setTimeout(() => {
      copied.value = copied.value.filter(item => item !== key)
      timers.delete(key)
    }, 2000))
  }
  function resetCopied() {
    timers.forEach(clearTimeout)
    timers.clear()
    copied.value = []
  }
  onScopeDispose(() => { disposed = true; resetCopied() })
  return { copied, markCopied, resetCopied }
}
