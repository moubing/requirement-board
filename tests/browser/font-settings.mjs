import { expect } from '@playwright/test'
import { nodeVisualDocument } from './node-visuals.mjs'

async function installedFonts(page) {
  return page.evaluate(async () => {
    const { createFontDetector } = await import('/app/utils/editor-fonts.ts')
    const detect = createFontDetector(document)
    return {
      body: ['Arial', 'Microsoft YaHei', 'Liberation Sans', 'DejaVu Sans'].find(detect),
      code: ['Consolas', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono'].find(detect),
      missing: detect('REQ29 Missing Font 90817'),
    }
  })
}
const font = locator => locator.evaluate(element => getComputedStyle(element).fontFamily)

export async function verifyFontSettings(page, url, screenshot) {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto(url)
  const families = await installedFonts(page)
  expect(families.body).toBeTruthy(); expect(families.code).toBeTruthy(); expect(families.missing).toBe(false)
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  const body = page.locator('.tiptap')
  const initial = await page.evaluate(() => {
    window.fontTestEditor = document.querySelector('.tiptap').editor
    return { json: window.fontTestEditor.getJSON(), selection: window.fontTestEditor.state.selection.toJSON() }
  })
  const uiFont = await font(trigger)
  const title = page.locator('.requirement-document-title .bing-input__field')
  const titleSize = await title.evaluate(element => getComputedStyle(element).fontSize)
  await page.evaluate(({ body, code }) => {
    window.fontReads = 0
    Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: async () => {
      window.fontReads++
      return [body, code, code, ...Array.from({ length: 250 }, (_, i) => `Test Font ${i}`)].map(family => ({ family }))
    } })
  }, families)
  async function open() {
    await trigger.click()
    await dialog.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: '正文字体', exact: true })).toBeVisible()
  }
  async function manual(label, family) {
    await dialog.getByRole('button', { name: `手动输入${label}`, exact: true }).click()
    await dialog.getByRole('textbox', { name: `${label}名称`, exact: true }).fill(family)
    await dialog.getByRole('button', { name: `检测并应用${label}`, exact: true }).click()
  }
  await open()
  expect(await page.evaluate(() => window.fontReads)).toBe(0)
  await expect(dialog.getByRole('combobox', { name: '正文字体', exact: true })).toContainText('Maple Mono NF CN（默认）')
  await dialog.getByRole('combobox', { name: '正文字体', exact: true }).click()
  await expect(page.getByRole('option').filter({ hasText: '本机未安装' }).first()).toBeDisabled()
  const installedPreset = page.getByRole('option').filter({ hasNotText: /默认|本机未安装|检测中/ }).first()
  if (await installedPreset.count()) {
    await installedPreset.click()
    expect(await page.evaluate(() => window.workspaceFixture.preferences.preferences.value.editor.fonts.body)).toBeTruthy()
  } else await page.keyboard.press('Escape')
  await manual('正文字体', 'Arial;display:none')
  await expect(dialog.getByRole('alert')).toContainText('仅支持')
  const beforeUnknown = await font(body)
  await dialog.getByRole('textbox', { name: '正文字体名称', exact: true }).fill('REQ29 Missing Font 90817')
  await dialog.getByRole('button', { name: '检测并应用正文字体', exact: true }).click()
  expect(await font(body)).toBe(beforeUnknown)
  await expect(dialog.locator('.app-settings-fonts__confirmation')).toContainText('将显示为回退字体')
  await dialog.getByRole('button', { name: '仍使用此字体', exact: true }).click()
  await expect(dialog.locator('[data-font-kind="body"] .app-settings-fonts__warning')).toContainText('将显示为回退字体')
  await manual('正文字体', families.body)
  await expect.poll(() => font(body)).toContain(families.body)
  await dialog.getByRole('button', { name: '读取本机字体', exact: true }).click()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('已缓存 252 个字体系列')
  expect(await page.evaluate(() => window.fontReads)).toBe(1)
  await dialog.getByRole('combobox', { name: '代码字体', exact: true }).click()
  // 大量字体采用虚拟列表，搜索与键盘选中仍可用。
  expect(await page.getByRole('option').count()).toBeLessThan(40)
  const search = page.getByPlaceholder(/^搜索字体名称/)
  await search.fill(families.code)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(dialog.getByRole('combobox', { name: '代码字体', exact: true })).toContainText(families.code)
  for (const code of await page.locator('.app-settings-preview code').all()) {
    await expect.poll(() => font(code)).toContain(families.code)
  }
  await expect.poll(() => font(page.locator('.app-settings-preview p').first())).toContain(families.body)
  await expect.poll(() => font(title)).toContain(families.body)
  await expect(title).toHaveCSS('font-size', titleSize)
  expect(await font(trigger)).toBe(uiFont)
  expect(await font(dialog.getByRole('heading', { name: '设置', exact: true }))).toBe(uiFont)
  const cookie = (await page.context().cookies()).find(cookie => cookie.name === 'rb-preferences')
  expect(JSON.parse(decodeURIComponent(cookie.value)).editor.fonts).toEqual({ body: families.body, code: families.code })
  expect(cookie.value).not.toContain('Test%20Font')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rb-local-fonts')).families.length)).toBe(252)
  // 完成设置会卸载弹窗；再次打开应从缓存恢复所有字体且不重新请求权限。
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await open()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('已缓存 252 个字体系列')
  await dialog.getByRole('combobox', { name: '正文字体', exact: true }).click()
  await page.getByPlaceholder(/^搜索字体名称/).fill('Test Font 149')
  await expect(page.getByRole('option', { name: 'Test Font 149', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.fontReads)).toBe(1)
  for (const theme of ['亮色', '暗色']) {
    await dialog.getByRole('tab', { name: '外观与交互', exact: true }).click()
    await dialog.getByRole('radio', { name: theme, exact: true }).focus(); await page.keyboard.press('Space')
    await dialog.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
    for (const width of [1440, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await dialog.getByRole('combobox', { name: '正文字体', exact: true }).scrollIntoViewIfNeeded()
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await screenshot(`fonts-${theme}-${width}`)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1024 })
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  expect(await page.evaluate(() => ({ same: window.fontTestEditor === document.querySelector('.tiptap').editor,
    json: window.fontTestEditor.getJSON(), selection: window.fontTestEditor.state.selection.toJSON() }))).toEqual({ same: true, ...initial })
  await page.evaluate(content => window.workspaceFixture.setComparison(content, content), {
    ...nodeVisualDocument, content: nodeVisualDocument.content.filter(node => node.type !== 'image'),
  })
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect.poll(() => font(page.locator('.diff-block p.diff-block__text').first())).toContain(families.body)
  for (const selector of ['.diff-block pre', '.diff-inline-mark--code']) await expect.poll(() => font(page.locator(selector).first())).toContain(families.code)
  await page.goto(url)
  await expect.poll(() => font(page.locator('.tiptap'))).toContain(families.body)
  await page.evaluate(() => {
    window.fontReads = 0
    Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: async () => { window.fontReads++; throw new DOMException('Denied', 'NotAllowedError') } })
  })
  await open()
  await expect(dialog.getByRole('combobox', { name: '代码字体', exact: true })).toContainText(families.code)
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('已缓存 252 个字体系列')
  await dialog.getByRole('combobox', { name: '正文字体', exact: true }).click()
  await page.getByPlaceholder(/^搜索字体名称/).fill('Test Font 149')
  await expect(page.getByRole('option', { name: 'Test Font 149', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.fontReads)).toBe(0)
  // 拒绝权限、浏览器不支持及 Cookie 拒绝写入均有明确反馈。
  await dialog.getByRole('button', { name: '重新读取本机字体', exact: true }).click()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('未获得本机字体读取权限')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rb-local-fonts')).families.length)).toBe(252)
  await page.evaluate(() => Object.defineProperty(document, 'cookie', { configurable: true, get: () => '', set: () => {} }))
  await manual('正文字体', 'REQ29 Missing Font 90817')
  await dialog.getByRole('button', { name: '仍使用此字体', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('尚未保存')
  await page.evaluate(() => { delete document.cookie })
  await dialog.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await manual('正文字体', families.body)
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await page.evaluate(() => Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: undefined }))
  await open()
  await expect(dialog.getByRole('button', { name: /^(重新)?读取本机字体$/ })).toHaveCount(0)
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('不支持读取本机字体')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  const historyContext = await page.evaluate(() => window.workspaceFixture.createSelectionContext())
  await page.goto(`${url}?selection=1&context=${historyContext}`)
  await expect.poll(() => font(page.locator('.selection-history-diff__content').first())).toContain(families.body)
  const codeHistory = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'visual-code'), nodeVisualDocument)
  await page.goto(`${url}?selection=1&context=${codeHistory}`)
  await expect.poll(() => font(page.locator('.selection-history-diff__content .requirement-code-block pre').first())).toContain(families.code)
  await page.goto(url)
  await open()
  await dialog.getByRole('button', { name: '恢复本页默认', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: '正文字体', exact: true })).toContainText('（默认）')
  await expect(dialog.getByRole('combobox', { name: '代码字体', exact: true })).toContainText('（默认）')
  await expect(page.locator('html')).toHaveAttribute('data-bing-theme', 'dark')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await verifyFontCacheRecovery(page, url)
  console.log('REQ-29 设置验证通过：三种字体来源、拒绝/不支持、虚拟列表与键盘、回退确认、Cookie 重试/刷新、标题/Diff/历史、UI 字体隔离、320/390/960/1440 亮暗主题。')
}

async function verifyFontCacheRecovery(page, url) {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  async function open() {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
  }
  await page.goto(url)
  await page.evaluate(() => Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: async () =>
    ['Refreshed Font', 'refreshed font', 'Arial;display:none'].map(family => ({ family })) }))
  await open()
  await dialog.getByRole('button', { name: '重新读取本机字体', exact: true }).click()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('已缓存 1 个字体系列')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rb-local-fonts')))).toEqual({ version: 1, families: ['Refreshed Font'] })
  await page.evaluate(() => {
    window.fontCacheSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'rb-local-fonts') throw new DOMException('Quota exceeded', 'QuotaExceededError')
      return window.fontCacheSetItem.call(this, key, value)
    }
    Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: async () => [{ family: 'Unsaved Font' }] })
  })
  await dialog.getByRole('button', { name: '重新读取本机字体', exact: true }).click()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('浏览器未能保存缓存')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await open()
  await expect(dialog.locator('.app-settings-fonts__local')).toContainText('浏览器未能保存缓存')
  await dialog.getByRole('combobox', { name: '正文字体', exact: true }).click()
  await page.getByPlaceholder(/^搜索字体名称/).fill('Unsaved Font')
  await expect(page.getByRole('option', { name: 'Unsaved Font', exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rb-local-fonts')).families)).toEqual(['Refreshed Font'])
  // 刷新清除临时内存，损坏/未知格式的缓存不影响设置页和预设字体。
  await page.evaluate(() => { Storage.prototype.setItem = window.fontCacheSetItem })
  for (const damaged of ['{broken', JSON.stringify({ version: 2, families: ['Ignored Font'] })]) {
    await page.evaluate(value => localStorage.setItem('rb-local-fonts', value), damaged)
    await page.goto(url)
    await open()
    await expect(dialog.locator('.app-settings-fonts__local')).not.toContainText('已缓存')
    await expect(dialog.getByRole('combobox', { name: '正文字体', exact: true })).toContainText('Maple Mono NF CN')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
  }
  await page.evaluate(() => localStorage.removeItem('rb-local-fonts'))
  console.log('本机字体缓存验证通过：完成后重开、刷新恢复、按需重读替换、拒绝保留、校验去重、损坏缓存与存储失败降级。')
}

export async function verifyEditorFonts(page) {
  const families = await installedFonts(page)
  await page.route('**/uploads/node-visuals.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"/>' }))
  const content = { ...nodeVisualDocument, content: [...nodeVisualDocument.content,
    ...Array.from({ length: 70 }, (_, index) => ({ type: 'paragraph', attrs: { diffId: `font-p-${index}` }, content: [{ type: 'text', text: `第 ${index} 段 · ${'Keep the current reading paragraph. 中文内容保持原有文档状态。'.repeat(8)}` }] }))] }
  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content, { versionBase: { type: 'doc', content: [] } }), { collaborative, content })
    await page.evaluate(() => document.fonts.ready)
    await page.locator('[data-diff-id="font-p-40"]').scrollIntoViewIfNeeded()
    // 给滚动锚点一次几何帧，随后以实际可见块检查字体换行后的偏移。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const before = await page.evaluate(() => {
      const root = document.querySelector('.tiptap'), viewport = root.closest('.bing-scrollbar__viewport')
      const bounds = viewport.getBoundingClientRect()
      const anchor = [...root.querySelectorAll('p[data-diff-id]')].find(p => p.getBoundingClientRect().bottom > bounds.top + 1)
      window.fontTestEditor = root.editor
      window.fontTestAnchor = { id: anchor.dataset.diffId, offset: anchor.getBoundingClientRect().top - bounds.top }
      return { json: root.editor.getJSON(), updates: window.editorFixture.localUpdates, state: window.editorFixture.collaborationState(), selection: root.editor.state.selection.toJSON() }
    })
    await page.evaluate(async families => {
      const { editorFontFamily } = await import('/app/utils/editor-fonts.ts')
      for (const kind of ['body', 'code']) document.documentElement.style.setProperty(`--rb-editor-font-${kind}`, editorFontFamily(families[kind]))
    }, families)
    await expect.poll(() => page.evaluate(() => {
      const anchor = document.querySelector(`[data-diff-id="${window.fontTestAnchor.id}"]`)
      return Math.abs(anchor.getBoundingClientRect().top - anchor.closest('.bing-scrollbar__viewport').getBoundingClientRect().top - window.fontTestAnchor.offset)
    })).toBeLessThan(2)
    // 换行后的连续标记仍对齐对应段落，并保持逐块悬停强调。
    await page.locator('[data-version-marker="inserted:font-p-40"]').hover()
    const highlight = page.locator('[data-version-highlight="inserted:font-p-40"]')
    await expect(highlight).toBeVisible()
    await expect.poll(async () => {
      const [block, emphasized] = await Promise.all([page.locator('[data-diff-id="font-p-40"]').boundingBox(), highlight.boundingBox()])
      return Math.abs(block.y + block.height / 2 - emphasized.y - emphasized.height / 2)
    }).toBeLessThan(2)
    await page.mouse.move(0, 0)
    for (const selector of ['p', 'h1', 'li p', 'blockquote p', '[data-requirement-callout]', 'td p', '.requirement-image__caption']) {
      await expect.poll(() => font(page.locator(`.tiptap ${selector}`).first()), { message: `${selector} 应使用正文字体` }).toContain(families.body)
    }
    for (const selector of ['pre', 'pre code', 'p code']) await expect.poll(() => font(page.locator(`.tiptap ${selector}`).first())).toContain(families.code)
    expect(await page.evaluate(() => ({ same: window.fontTestEditor === window.editorFixture.editor(), json: window.editorFixture.editor().getJSON(),
      updates: window.editorFixture.localUpdates, state: window.editorFixture.collaborationState(), selection: window.editorFixture.editor().state.selection.toJSON() }))).toEqual({ same: true, ...before })
    await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection(2); window.editorFixture.separateHistory(); editor.commands.insertContent('新增可撤销')
      document.documentElement.style.removeProperty('--rb-editor-font-body')
      document.documentElement.style.removeProperty('--rb-editor-font-code')
      editor.commands.undo()
    })
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before.json)
  }
  await page.evaluate(async ({ content, families }) => {
    await window.editorFixture.mountRevision(content)
    const { editorFontFamily } = await import('/app/utils/editor-fonts.ts')
    for (const kind of ['body', 'code']) document.documentElement.style.setProperty(`--rb-editor-font-${kind}`, editorFontFamily(families[kind]))
  }, { content: nodeVisualDocument, families })
  await expect.poll(() => font(page.locator('.requirement-revision-viewer p').first())).toContain(families.body)
  await expect.poll(() => font(page.locator('.requirement-revision-viewer pre').first())).toContain(families.code)
  await page.evaluate(() => { document.documentElement.style.removeProperty('--rb-editor-font-body'); document.documentElement.style.removeProperty('--rb-editor-font-code') })
  console.log('REQ-29 编辑器验证通过：全节点/只读字体、长文阅读锚点、普通与真实 Yjs 状态及个人撤销保持。')
}
