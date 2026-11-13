import { describe, expect, it } from 'vitest'

import {
  isPasswordLengthValid,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../../server/utils/password-policy'

describe('password policy', () => {
  it('accepts passwords from 6 through 128 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6)
    expect(MAX_PASSWORD_LENGTH).toBe(128)
    expect(isPasswordLengthValid('12345')).toBe(false)
    expect(isPasswordLengthValid('123456')).toBe(true)
    expect(isPasswordLengthValid('a'.repeat(128))).toBe(true)
    expect(isPasswordLengthValid('a'.repeat(129))).toBe(false)
  })
})
