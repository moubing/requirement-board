import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../app/utils/detail-return-timing', () => ({ beginDetailReturnTiming: () => undefined }))
vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: unknown) => middleware)
const { default: middleware } = await import('../../app/middleware/auth.global')
afterEach(() => vi.unstubAllGlobals())

describe('游客路由边界', () => {
  it.each(['/demo', '/demo/'])('固定入口 %s 不读取账号、不覆盖已有身份', async path => {
    const fetch = vi.fn()
    vi.stubGlobal('useRequestFetch', fetch)
    const to = { path, fullPath: `${path}?documentId=private&revision=v99`, query: {}, meta: {} }
    await middleware(to as never, {} as never)
    expect(fetch).not.toHaveBeenCalled()
    expect(to.meta).toEqual({})
  })
  it.each(['/demo/private', '/demographic', '/requirements/private', '/selection-history/private'])('其他地址 %s 仍需认证', async path => {
    const fetch = vi.fn().mockRejectedValue({ statusCode: 401 })
    const navigate = vi.fn()
    vi.stubGlobal('useRequestFetch', () => fetch)
    vi.stubGlobal('navigateTo', navigate)
    await middleware({ path, fullPath: path, query: {}, meta: {} } as never, {} as never)
    expect(fetch).toHaveBeenCalledWith('/api/account/access')
    expect(navigate).toHaveBeenCalledWith({ path: '/login', query: { redirect: path } })
  })
})
