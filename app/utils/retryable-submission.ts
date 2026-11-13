import { nanoid } from 'nanoid'

/** 响应不明时保留原输入与请求 ID；先核验该次写入，再接受另一份创建输入。 */
export function createRetryableSubmission<T>() {
  let pending: { key: string; input: T; fingerprint: string } | undefined
  return {
    capture(input: T) {
      const fingerprint = JSON.stringify(input)
      if (pending && pending.fingerprint !== fingerprint) throw new Error('上次提交结果尚未确认，请恢复上次输入并重试核验，再提交新的内容。')
      return pending ??= { key: nanoid(24), input: structuredClone(input), fingerprint }
    },
    confirmed() { pending = undefined },
    recover() { return pending ? structuredClone(pending.input) : undefined },
    failed(error: unknown) {
      const status = (error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status
      if (status && status >= 400 && status < 500 && status !== 408) pending = undefined
    },
  }
}
