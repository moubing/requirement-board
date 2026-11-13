import type { BingToastService } from '@moubing/bing-ui'

/** 提示跟随请求和账号，页面卸载不取消已提交的写入，也不把结果带到另一个账号。 */
export function createOperationFeedback(scope: () => string, toast: BingToastService) {
  return {
    begin(message: string, id?: string) {
      const owner = scope()
      const toastId = toast.loading({ id, message, position: 'top-center', duration: 0 })
      const isCurrent = () => owner === scope()
      const update = (type: 'loading' | 'success' | 'error' | 'warning', message: string) => {
        if (!isCurrent() || !toast.getToasts().some(item => item.id === toastId)) return
        toast[type]({ id: toastId, message, position: 'top-center', duration: type === 'loading' ? 0 : type === 'success' ? 2600 : 6500 })
      }
      return {
        isCurrent,
        loading: (message: string) => update('loading', message),
        success: (message: string) => update('success', message),
        error: (message: string) => update('error', message),
        warning: (message: string) => update('warning', message),
        async refresh(task: () => Promise<unknown>, failed: () => unknown = () => false) {
          if (!isCurrent()) return
          try {
            await task()
            if (failed()) throw new Error('refresh failed')
          } catch { update('warning', '操作已成功，最新列表暂未加载，请稍后刷新。') }
        },
      }
    },
  }
}
