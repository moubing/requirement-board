import { describe, expect, it } from 'vitest'

import { resolveAuthRuntimeConfig } from '../../server/utils/auth-config'

const secret = 'test-auth-secret-with-at-least-32-characters'

describe('auth runtime configuration', () => {
  it('requires an explicit secret and URL in production', () => {
    expect(() => resolveAuthRuntimeConfig({}, 'production')).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => resolveAuthRuntimeConfig({ BETTER_AUTH_SECRET: secret }, 'production')).toThrow(/BETTER_AUTH_URL/)
  })

  it('requires HTTPS for non-loopback origins', () => {
    expect(() => resolveAuthRuntimeConfig({
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'http://requirements.example.com',
    }, 'production')).toThrow(/HTTPS/)
  })

  it('normalizes and deduplicates trusted origins', () => {
    expect(resolveAuthRuntimeConfig({
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://requirements.example.com/',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://requirements.example.com,https://staging.example.com/',
    }, 'production')).toEqual({
      secret,
      baseURL: 'https://requirements.example.com',
      cookiePrefix: 'better-auth',
      trustedOrigins: [
        'https://requirements.example.com',
        'https://staging.example.com',
      ],
    })
  })

  it('accepts distinct prefixes for HTTPS origins on the same IP', () => {
    const prod = resolveAuthRuntimeConfig({ BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://203.0.113.10', BETTER_AUTH_COOKIE_PREFIX: 'rb-prod' }, 'production')
    const staging = resolveAuthRuntimeConfig({ BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://203.0.113.10:8443', BETTER_AUTH_COOKIE_PREFIX: 'rb-staging' }, 'production')
    expect(prod.cookiePrefix).toBe('rb-prod')
    expect(staging.cookiePrefix).toBe('rb-staging')
    expect(prod.trustedOrigins).toEqual(['https://203.0.113.10'])
    expect(staging.trustedOrigins).toEqual(['https://203.0.113.10:8443'])
  })

  it.each(['rb.prod', 'rb;prod', 'rb prod', '__Secure-rb', 'x'.repeat(49)])('rejects unsafe Cookie prefix %s', (cookiePrefix) => {
    expect(() => resolveAuthRuntimeConfig({ BETTER_AUTH_COOKIE_PREFIX: cookiePrefix }, 'development'))
      .toThrow(/BETTER_AUTH_COOKIE_PREFIX/)
  })
})
