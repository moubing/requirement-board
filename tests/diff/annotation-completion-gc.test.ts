import { afterEach, expect, it, vi } from 'vitest'

const { expire, database } = vi.hoisted(() => ({ expire: vi.fn<() => Promise<void>>(), database: {} }))
vi.mock('../../server/services/annotation-completions', () => ({ expireAnnotationCompletions: expire }))
vi.mock('../../server/db/client', () => ({ useDatabase: () => database }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expire.mockReset() })

async function start() {
  vi.useFakeTimers()
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  vi.resetModules()
  const plugin = (await import('../../server/plugins/annotation-completions')).default
  let close!: () => Promise<void>
  plugin({ hooks: { hook: (_name: string, handler: typeof close) => { close = handler } } } as never)
  await Promise.resolve()
  return () => close()
}

it('启动和每小时自动回收，慢任务不重叠，服务关闭后停止清理', async () => {
  let finish!: () => void
  expire.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(undefined)
  const close = await start()
  expect(expire).toHaveBeenCalledExactlyOnceWith(database)
  await vi.advanceTimersByTimeAsync(3600000)
  expect(expire).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(3600000)
  expect(expire).toHaveBeenCalledTimes(2)
  await close()
  await vi.advanceTimersByTimeAsync(3600000)
  expect(expire).toHaveBeenCalledTimes(2)
})

it('后台清理失败不会阻止启动，下个周期重试', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expire.mockRejectedValueOnce(new Error('数据库暂不可用')).mockResolvedValue(undefined)
  const close = await start()
  await vi.advanceTimersByTimeAsync(0)
  expect(log).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(3600000)
  expect(expire).toHaveBeenCalledTimes(2)
  await close()
})
