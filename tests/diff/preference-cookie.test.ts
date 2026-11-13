// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { savePreferenceCookie } from '../../app/utils/preference-cookie'

afterEach(() => { delete (document as unknown as Record<string, unknown>).cookie; document.cookie = 'rb-preferences=;max-age=0;path=/'; document.cookie = 'rb-theme=;max-age=0;path=/' })
describe('个人设置持久化反馈', () => {
  it('写回兼容 JSON，颜色透明度及主题可读回', () => {
    expect(savePreferenceCookie('rb-preferences', { version: 1, color: '#33445580' })).toBe('')
    expect(decodeURIComponent(document.cookie)).toContain('#33445580')
    expect(savePreferenceCookie('rb-theme', 'dark')).toBe('')
    expect(decodeURIComponent(document.cookie)).toContain('rb-theme="dark"')
  })
  it('浏览器抛错或静默拒绝 Cookie 时明确报告当前效果未保存', () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => undefined })
    expect(savePreferenceCookie('rb-theme', 'dark')).toContain('尚未保存')
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => { throw new Error('blocked') } })
    expect(savePreferenceCookie('rb-preferences', { version: 1 })).toContain('尚未保存')
  })
})
