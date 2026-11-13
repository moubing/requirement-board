import { getCookies, getSessionCookie } from 'better-auth/cookies'
import { describe, expect, it } from 'vitest'

describe('environment Cookie isolation', () => {
  it('uses distinct Secure, HttpOnly, host-only cookies for all built-in auth cookies', () => {
    const prod = getCookies({ baseURL: 'https://203.0.113.10', advanced: { cookiePrefix: 'rb-prod' } })
    const staging = getCookies({ baseURL: 'https://203.0.113.10:8443', advanced: { cookiePrefix: 'rb-staging' } })
    for (const key of Object.keys(prod) as (keyof typeof prod)[]) {
      expect(prod[key].name).toMatch(/^__Secure-rb-prod\./)
      expect(staging[key].name).toMatch(/^__Secure-rb-staging\./)
      for (const cookie of [prod[key], staging[key]]) {
        expect(cookie.attributes).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax', path: '/' })
        expect(cookie.attributes.domain).toBeUndefined()
      }
    }
  })

  it('reads only its own session when the browser sends both environments', () => {
    const headers = new Headers({ cookie: '__Secure-rb-prod.session_token=prod-token; __Secure-rb-staging.session_token=staging-token' })
    expect(getSessionCookie(headers, { cookiePrefix: 'rb-prod' })).toBe('prod-token')
    expect(getSessionCookie(headers, { cookiePrefix: 'rb-staging' })).toBe('staging-token')
    expect(getSessionCookie(new Headers({ cookie: '__Secure-rb-prod.session_token=prod-token' }), { cookiePrefix: 'rb-staging' })).toBeNull()
  })
})
