import { getCookies, getSessionCookie } from 'better-auth/cookies'
import { describe, expect, it } from 'vitest'
import { localDevAuthEnvironment } from '../../scripts/local-dev-auth'
import { resolveAuthRuntimeConfig } from '../../server/utils/auth-config'

const env = { NODE_ENV: 'development', BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3000', BETTER_AUTH_COOKIE_PREFIX: 'rb-local' }

describe('本地多 worktree 认证配置', () => {
  it('使用实际监听端口，同步三种回环来源，不信任旧端口或其他网站', () => {
    const overrides = localDevAuthEnvironment('http://localhost:3001/', '/worktree/one', env)!
    const config = resolveAuthRuntimeConfig({ ...env, ...overrides }, 'development')
    expect(config.baseURL).toBe('http://localhost:3001')
    expect(config.trustedOrigins).toEqual(['http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001'])
    expect(config.trustedOrigins).not.toContain('http://localhost:3000')
    expect(config.trustedOrigins).not.toContain('https://attacker.example')
    expect(env.BETTER_AUTH_URL).toBe('http://localhost:3000')
    expect(localDevAuthEnvironment('http://localhost:3001/', '/worktree/one', { ...env, ...overrides })).toEqual(overrides)
  })

  it.each(['http://0.0.0.0:4321', 'http://[::]:4321'])('监听所有网卡时仍只自动信任本地回环：%s', url => {
    const overrides = localDevAuthEnvironment(url, '/worktree/one', env)!
    expect(overrides.BETTER_AUTH_URL).toBe('http://localhost:4321')
    expect(overrides.BETTER_AUTH_TRUSTED_ORIGINS).toBe('http://localhost:4321,http://127.0.0.1:4321,http://[::1]:4321')
  })

  it('不同 worktree 或端口隔离 Cookie，同一实例重启保持名称', () => {
    const create = (root: string, port: number) => resolveAuthRuntimeConfig({ ...env,
      ...localDevAuthEnvironment(`http://localhost:${port}`, root, env) }, 'development')
    const a = create('/worktree/one', 3000), b = create('/worktree/two', 3001)
    expect(a.cookiePrefix).toMatch(/^rb-dev-[a-f0-9]{10}-3000$/)
    expect(a.cookiePrefix).toBe(create('/worktree/one', 3000).cookiePrefix)
    expect(a.cookiePrefix).not.toBe(create('/worktree/two', 3000).cookiePrefix)
    expect(a.cookiePrefix).not.toBe(create('/worktree/one', 3001).cookiePrefix)
    const aCookies = getCookies({ baseURL: a.baseURL, advanced: { cookiePrefix: a.cookiePrefix } })
    const bCookies = getCookies({ baseURL: b.baseURL, advanced: { cookiePrefix: b.cookiePrefix } })
    for (const key of Object.keys(aCookies) as (keyof typeof aCookies)[]) {
      expect(aCookies[key].name).not.toBe(bCookies[key].name)
      expect(aCookies[key].attributes).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
      expect(aCookies[key].attributes.domain).toBeUndefined()
    }
    const headers = new Headers({ cookie: `${aCookies.sessionToken.name}=first; ${bCookies.sessionToken.name}=second` })
    expect(getSessionCookie(headers, { cookiePrefix: a.cookiePrefix })).toBe('first')
    expect(getSessionCookie(headers, { cookiePrefix: b.cookiePrefix })).toBe('second')
  })

  it('HTTPS 与 IPv6 回环使用实际协议、地址和端口', () => {
    const overrides = localDevAuthEnvironment('https://[::1]:4443/', '/worktree/one', env)!
    expect(overrides.BETTER_AUTH_URL).toBe('https://[::1]:4443')
    expect(overrides.BETTER_AUTH_TRUSTED_ORIGINS).toBe('https://localhost:4443,https://127.0.0.1:4443,https://[::1]:4443')
  })

  it.each(['production', 'test'])('%s 不启用本地自动配置', NODE_ENV => {
    expect(localDevAuthEnvironment('http://localhost:3001', '/worktree/one', { ...env, NODE_ENV })).toBeNull()
  })

  it.each(['https://requirements.example.com', 'not-a-url', 'http://localhost:3000/path', 'http://user:pass@localhost:3000'])('保留显式域名配置及原校验：%s', BETTER_AUTH_URL => {
    expect(localDevAuthEnvironment('http://localhost:3001', '/worktree/one', { ...env, BETTER_AUTH_URL })).toBeNull()
  })

  it('公网或局域网监听地址不自动加入可信来源', () => {
    expect(localDevAuthEnvironment('http://192.168.1.10:3001', '/worktree/one', env)).toBeNull()
  })
})
