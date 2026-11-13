import { expect, it, vi } from 'vitest'
import { createCoalescedRefresh } from '../../app/utils/coalesced-refresh'

it('合并同一轮通知，保留请求过程中发生的后续变更，卸载后不再请求', async () => {
  let finish!: () => void
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
  const queue = createCoalescedRefresh<string>(refresh)
  const first = queue.request(['detail', 'index'])
  queue.request(['detail', 'related'])
  await Promise.resolve()
  expect(refresh).toHaveBeenCalledExactlyOnceWith(['detail', 'index', 'related'])
  queue.request(['detail']); queue.request(['detail', 'index'])
  expect(refresh).toHaveBeenCalledTimes(1)
  finish(); await first
  expect(refresh).toHaveBeenLastCalledWith(['detail', 'index'])
  expect(refresh).toHaveBeenCalledTimes(2)
  queue.dispose(); await queue.request(['detail'])
  expect(refresh).toHaveBeenCalledTimes(2)
})

it('上一轮刚完成时到达的新通知仍会刷新，不遗留在已经结束的队列里', async () => {
  let finish!: () => void
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
  const queue = createCoalescedRefresh<string>(refresh)
  const first = queue.request(['detail'])
  await Promise.resolve()
  finish()
  await Promise.resolve()
  await queue.request(['index'])
  await first
  expect(refresh).toHaveBeenNthCalledWith(2, ['index'])
})
