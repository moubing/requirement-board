import { describe, expect, it } from 'vitest'

import { resolveAuthRedirect } from '../../app/utils/auth-redirect'

describe('auth redirect', () => {
  it('keeps safe local paths and their query string', () => {
    expect(resolveAuthRedirect('/requirements/req_1?view=history#revision')).toBe(
      '/requirements/req_1?view=history#revision',
    )
  })

  it('rejects external, encoded external, and login-loop redirects', () => {
    expect(resolveAuthRedirect('https://example.com')).toBe('/')
    expect(resolveAuthRedirect('//example.com')).toBe('/')
    expect(resolveAuthRedirect('/%2Fexample.com')).toBe('/')
    expect(resolveAuthRedirect('/\\example.com')).toBe('/')
    expect(resolveAuthRedirect('/login?redirect=/requirements/req_1')).toBe('/')
    expect(resolveAuthRedirect('/login/?redirect=/requirements/req_1')).toBe('/')
    expect(resolveAuthRedirect('/register?redirect=/login')).toBe('/')
    expect(resolveAuthRedirect('/register/', '/account')).toBe('/account')
    expect(resolveAuthRedirect('/invite')).toBe('/invite')
  })

  it('accepts the first value from a Nuxt query array', () => {
    expect(resolveAuthRedirect(['/requirements/req_1', '/requirements/req_2'])).toBe(
      '/requirements/req_1',
    )
  })
})
