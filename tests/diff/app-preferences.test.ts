import { describe, expect, it } from 'vitest'
import { appPreferenceHtmlAttrs, defaultAppPreferences, normalizeAppPreferences } from '../../app/utils/app-preferences'
import { editorFontFamily, normalizeEditorFont } from '../../app/utils/editor-fonts'

describe('个人显示偏好', () => {
  it('缺失、损坏和未知版本的偏好保留原有显示默认值', () => {
    for (const value of [null, '', [], { version: 2 }, { version: 1, editor: null, customCursor: 'false' }]) {
      expect(normalizeAppPreferences(value)).toEqual(defaultAppPreferences())
    }
    expect(appPreferenceHtmlAttrs(defaultAppPreferences())).toEqual({
      style: '--rb-editor-width:880px', 'data-editor-sizes': '', 'data-editor-colors': '', 'data-editor-line-height': undefined,
    })
  })

  it('限制字号、行高和宽度，丢弃无效颜色及未知字段', () => {
    const preferences = normalizeAppPreferences({ version: 1, customCursor: false, injected: 'ignored', editor: {
      lineHeight: 100, documentWidth: -1, text: {
        h1: { fontSize: 999, colors: { light: '#ABCDEF80', dark: 'red;display:none' } },
        h2: { fontSize: NaN, colors: { light: '#123', dark: 'url(https://example.com)' } },
        h3: { fontSize: 0 }, paragraph: { fontSize: '20' },
      },
    } })
    expect(preferences.customCursor).toBe(false)
    expect(preferences.editor).toEqual({ fonts: { body: null, code: null }, lineHeight: 2.4, documentWidth: 640, panelWidth: 360, versionMarkers: true, text: {
      h1: { fontSize: 72, colors: { light: '#abcdef80', dark: null } },
      h2: { fontSize: null, colors: { light: null, dark: null } },
      h3: { fontSize: 12, colors: { light: null, dark: null } },
      paragraph: { fontSize: null, colors: { light: null, dark: null } },
    } })
    expect(preferences).not.toHaveProperty('injected')
    expect(appPreferenceHtmlAttrs(preferences).style).not.toMatch(/display|url/)
  })

  it('旧 Cookie 补全两类字体，字体独立持久化且通过 HTML 属性在首屏生效', () => {
    expect(normalizeAppPreferences({ version: 1, editor: { documentWidth: 1200 } }).editor).toMatchObject({ fonts: { body: null, code: null }, documentWidth: 1200 })
    const value = { version: 1, editor: { fonts: { body: '  微软雅黑  ', code: 'JetBrains Mono' } } }
    const preferences = normalizeAppPreferences(JSON.parse(JSON.stringify(value)))
    expect(preferences.editor.fonts).toEqual({ body: '微软雅黑', code: 'JetBrains Mono' })
    expect(appPreferenceHtmlAttrs(preferences).style).toContain('--rb-editor-font-body:"微软雅黑",var(--font-main);--rb-editor-font-code:"JetBrains Mono",var(--font-main)')
    expect(editorFontFamily(null)).toBe('var(--font-main)')
  })

  it('字体整串白名单与长度限制阻止 Cookie 注入，不裁剪非法部分', () => {
    for (const value of ['a'.repeat(65), 'Arial;display:none', 'Arial"', "Arial'", 'url(x)', 'a\\b', 'a\nb', 'a\tb', '<style>', ['Arial'], 42, '']) {
      expect(normalizeEditorFont(value)).toBeNull()
      const preferences = normalizeAppPreferences({ version: 1, editor: { fonts: { body: value, code: value } } })
      expect(preferences.editor.fonts).toEqual({ body: null, code: null })
      expect(appPreferenceHtmlAttrs(preferences).style).toBe('--rb-editor-width:880px')
    }
    for (const family of ['a'.repeat(64), '思源黑体 CN', 'Font_1-2.3']) expect(normalizeEditorFont(family)).toBe(family)
  })

  it.each([true, false])('旧版 Cookie 保留已保存的指针开关 %s 及有效字段；缺失面板宽度补默认值', customCursor => {
    const legacy = { version: 1, customCursor, editor: { documentWidth: 1320, lineHeight: 2, panelWidth: undefined, text: { paragraph: { fontSize: 20 } } } }
    expect(normalizeAppPreferences(legacy)).toMatchObject({ customCursor, editor: { documentWidth: 1320, lineHeight: 2, panelWidth: 360, text: { paragraph: { fontSize: 20 } } } })
    expect(normalizeAppPreferences({ ...legacy, editor: { ...legacy.editor, panelWidth: 999 } }).editor).toMatchObject({ panelWidth: 560, documentWidth: 1320 })
  })

  it('亮暗颜色独立保存，另一主题仍使用语义色；JSON 往返不丢透明度', () => {
    const original = defaultAppPreferences()
    original.editor.text.paragraph = { fontSize: 20, colors: { light: '#33445580', dark: null } }
    original.editor.lineHeight = 2
    const restored = normalizeAppPreferences(JSON.parse(JSON.stringify(original)))
    expect(restored).toEqual(original)
    expect(appPreferenceHtmlAttrs(restored)).toEqual({
      'data-editor-sizes': 'paragraph', 'data-editor-colors': 'paragraph', 'data-editor-line-height': '',
      style: '--rb-editor-width:880px;--rb-editor-paragraph-size:20px;--rb-editor-paragraph-color:light-dark(#33445580,var(--rb-ink));--rb-editor-line-height:2',
    })
    restored.editor.text.h1.colors.dark = '#ffffff'
    expect(original.editor.text.h1.colors.dark).toBeNull()
    expect(defaultAppPreferences().editor.text.paragraph.fontSize).toBeNull()
  })
})
