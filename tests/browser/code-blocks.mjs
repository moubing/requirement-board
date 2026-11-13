import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const code = '  // 中文😀\nconst answer: number = 42\n\nconsole.log(answer)\n'
const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const block = (id, text = code, language = 'typescript', title = null) => ({ type: 'codeBlock', attrs: { diffId: id, language, title }, content: [{ type: 'text', text }] })
export const codeDocument = { type: 'doc', content: [p('intro', '代码说明'), block('code-main', code, 'typescript', 'example.ts'), p('tail')] }
async function select(page, id, offset = 1) {
  await page.locator('.tiptap').evaluate((el, { id, offset }) => {
    el.editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) el.editor.commands.setTextSelection(pos + offset) })
    el.editor.view.focus()
  }, { id, offset })
}
async function language(page, block, label) {
  await block.getByRole('combobox', { name: '代码语言', exact: true }).click()
  await page.getByRole('combobox', { name: '搜索语言' }).fill(label)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
}
async function capture(page, name) {
  if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
  await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`), fullPage: true })
}

export async function verifyEditorCodeBlocks(page) {
  // 首次挂载的代码块远离视口，不加载语法或创建 token。
  await page.evaluate(content => window.editorFixture.mount(false, content), { type: 'doc', content: [
    ...Array.from({ length: 80 }, (_, i) => p(`intro-${i}`, `正文 ${i}`)), block('offscreen'), p('tail'),
  ] })
  await page.waitForTimeout(250)
  await expect(page.locator('.requirement-code-token')).toHaveCount(0)
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /shiki.*(?:core|lang|engine)/i.test(item.name)).length)).toBe(0)
  await page.locator('[data-diff-id="offscreen"]').scrollIntoViewIfNeeded()
  await expect(page.locator('[data-diff-id="offscreen"]')).toHaveAttribute('data-code-highlight', 'ready')

  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content: codeDocument })
    const target = page.locator('.tiptap [data-diff-id="code-main"]')
    await expect(target).toHaveAttribute('data-code-highlight', 'ready')
    const original = await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, local: window.editorFixture.localUpdates }))
    await select(page, 'code-main', 10)
    const selection = await page.evaluate(() => window.editorFixture.editor().state.selection.toJSON())
    await page.evaluate(() => {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard)
      navigator.clipboard.writeText = text => { window.codeCopyArgument = text; return write(text) }
    })
    await target.getByRole('button', { name: '复制代码', exact: true }).click()
    expect(await page.evaluate(() => window.codeCopyArgument)).toBe(code)
    // Windows 系统剪贴板统一使用 CRLF；写入参数仍须保持原文。
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(code)
    await expect(page.getByText('代码已复制', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.toJSON())).toEqual(selection)
    expect(await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, local: window.editorFixture.localUpdates }))).toEqual(original)
    // 真实输入后改变语言，后续输入和语言变化必须分属各自的撤销事件。
    await page.keyboard.insertText('x')
    const typed = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await language(page, target, 'JavaScript')
    await expect(target.locator('code')).toHaveClass(/language-javascript/)
    await select(page, 'code-main', 2); await page.keyboard.insertText('y')
    await page.keyboard.press('Control+z')
    await expect(target.locator('code')).toHaveClass(/language-javascript/)
    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(typed)
    await page.keyboard.press('Control+Shift+z')
    await expect(target.locator('code')).toHaveClass(/language-javascript/)
    await language(page, target, '纯文本')
    await expect(target.locator('.requirement-code-token')).toHaveCount(0)
    // 浏览器 IME 组词过程不应用装饰；提交后恢复高亮且光标留在原代码块。
    await language(page, target, 'TypeScript')
    await expect(target).toHaveAttribute('data-code-highlight', 'ready')
    await select(page, 'code-main', 3)
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 })
      await page.waitForTimeout(200)
      expect(await page.evaluate(() => window.editorFixture.editor().view.composing)).toBe(true)
      await cdp.send('Input.insertText', { text: '中文' })
      await expect(target.locator('code')).toContainText('中文')
      expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('codeBlock')
      await expect(target).toHaveAttribute('data-code-highlight', 'ready')
    } finally { await cdp.detach() }
    // 名称是可撤销属性，输入框确认与组词不会往代码正文插字或换行。
    const name = target.getByRole('textbox', { name: '代码块名称', exact: true })
    const beforeNaming = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await name.fill('utils.ts'); await name.press('Enter')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[1].attrs.title)).toBe('utils.ts')
    await select(page, 'code-main'); await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(beforeNaming)
    await page.keyboard.press('Control+Shift+z'); await expect(name).toHaveValue('utils.ts')
    await name.fill('放弃名称'); await name.press('Escape'); await expect(name).toHaveValue('utils.ts')
    await name.fill('失焦保存.ts'); await target.locator('code').click()
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[1].attrs.title)).toBe('失焦保存.ts')
    await name.fill('')
    const nameCdp = await page.context().newCDPSession(page)
    try {
      await nameCdp.send('Input.imeSetComposition', { text: 'ming', selectionStart: 4, selectionEnd: 4 })
      expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[1].attrs.title)).toBe('失焦保存.ts')
      await nameCdp.send('Input.insertText', { text: '命名示例.ts' })
      await expect(name).toHaveValue('命名示例.ts')
      await name.press('Enter')
    } finally { await nameCdp.detach() }
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[1].attrs.title)).toBe('命名示例.ts')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[1].content)).toEqual(beforeNaming.content[1].content)
    // 跨块复制使用 schema 序列化，不包含语言菜单、复制按钮或 token。
    await page.evaluate(() => { const editor = window.editorFixture.editor(); editor.commands.selectAll(); editor.view.focus() })
    await page.keyboard.press('Control+c')
    const plain = await page.evaluate(() => navigator.clipboard.readText())
    expect(plain).toContain('代码说明'); expect(plain).not.toMatch(/代码语言|复制代码|TypeScript|命名示例/)
    const html = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text())
    expect(html).toContain('<pre'); expect(html).not.toMatch(/<button|requirement-code-token|requirement-code-block__header/)
    expect(html).toContain('data-code-title="命名示例.ts"')
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await expect(target.getByRole('combobox', { name: '代码语言', exact: true })).toHaveCount(0)
    await expect(target.locator('.requirement-code-block__language')).toHaveText('TypeScript')
    await expect(target.locator('.requirement-code-block__name')).toHaveText('命名示例.ts')
    await expect(target.getByRole('textbox', { name: '代码块名称', exact: true })).toHaveCount(0)
    await page.evaluate(() => window.editorFixture.setDisabled(false))
  }
  // 失败复制反馈清楚，失败后仍能再次操作。
  await page.evaluate(content => window.editorFixture.mount(false, content), codeDocument)
  await page.evaluate(() => {
    window.originalCodeClipboard = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async () => { throw new DOMException('denied', 'NotAllowedError') }
  })
  await page.getByRole('button', { name: '复制代码', exact: true }).click()
  await expect(page.getByText('复制代码失败：剪贴板权限被拒绝，请允许访问后重试', { exact: true })).toBeVisible()
  await page.evaluate(() => { navigator.clipboard.writeText = window.originalCodeClipboard; window.editorFixture.clearToasts() })
  const snapshot = await page.evaluate(() => window.editorFixture.editor().getJSON())
  let lightColor
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
    await expect(page.locator('.requirement-code-token').first()).toBeVisible()
    if (theme === 'light') lightColor = await page.locator('.requirement-code-token').first().evaluate(node => getComputedStyle(node).color)
    else await expect.poll(() => page.locator('.requirement-code-token').first().evaluate(node => getComputedStyle(node).color)).not.toBe(lightColor)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const header = page.locator('.requirement-code-block__header')
      const geometry = await header.evaluate(node => {
        const box = node.getBoundingClientRect(), language = node.querySelector('[aria-label="代码语言"]').getBoundingClientRect()
        const input = node.querySelector('input').getBoundingClientRect(), copy = node.querySelector('.requirement-code-block__copy').getBoundingClientRect()
        return { height: box.height, topSpace: language.top - box.top, bottomSpace: box.bottom - Math.max(input.bottom, copy.bottom), fits: input.right <= box.right && copy.right <= box.right,
          separated: input.top >= language.bottom || input.left >= language.right }
      })
      expect(geometry.height).toBeGreaterThanOrEqual(52)
      expect(geometry.topSpace).toBeGreaterThanOrEqual(8); expect(geometry.bottomSpace).toBeGreaterThanOrEqual(8)
      expect(geometry.fits && geometry.separated).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await capture(page, `req-31-editor-${theme}-${width}`)
    }
  }
  expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(snapshot)
  await page.evaluate(content => window.editorFixture.mountRevision(content), codeDocument)
  await expect(page.locator('.requirement-code-block')).toHaveAttribute('data-code-highlight', 'ready')
  await expect(page.locator('.requirement-code-block__language')).toHaveText('TypeScript')
  await expect(page.locator('.requirement-code-block__name')).toHaveText('example.ts')
  await expect(page.getByRole('combobox', { name: '代码语言', exact: true })).toHaveCount(0)
  for (const content of [block('large', 'x\n'.repeat(2000)), block('large', '中'.repeat(35000)), block('large', code, 'unsupported')]) {
    await page.evaluate(content => window.editorFixture.mount(false, { type: 'doc', content: [content] }), content)
    await page.waitForTimeout(200); await expect(page.locator('.requirement-code-token')).toHaveCount(0)
  }
  await verifyCodeSync(page)
  console.log('通过：代码懒加载、语言/独立撤销、IME、复制/失败、跨块剪贴板、只读、大小限制、亮暗/窄屏与双页 Yjs。')
}

async function verifyCodeSync(page) {
  await page.evaluate(content => window.editorFixture.mount(true, content), codeDocument)
  const remote = await page.context().newPage()
  try {
    await remote.goto(page.url()); await remote.waitForFunction(() => window.editorFixture)
    const state = await page.evaluate(() => window.editorFixture.collaborationState())
    await remote.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content: codeDocument, state })
    await select(remote, 'code-main', 3); await remote.keyboard.insertText('远端文字')
    await page.getByRole('textbox', { name: '代码块名称', exact: true }).fill('collaboration.ts')
    await page.getByRole('textbox', { name: '代码块名称', exact: true }).press('Enter')
    await language(page, page.locator('[data-diff-id="code-main"]'), 'JavaScript')
    const localState = await page.evaluate(() => window.editorFixture.collaborationState())
    await page.evaluate(state => window.editorFixture.receiveState(state), await remote.evaluate(() => window.editorFixture.collaborationState()))
    await remote.evaluate(state => window.editorFixture.receiveState(state), localState)
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(await remote.evaluate(() => window.editorFixture.editor().getJSON()))
    await select(page, 'code-main'); await page.keyboard.press('Control+z')
    await expect(page.locator('[data-diff-id="code-main"] code')).toHaveClass(/language-typescript/)
    await expect(page.locator('[data-diff-id="code-main"] code')).toContainText('远端文字')
    await expect(page.getByRole('textbox', { name: '代码块名称', exact: true })).toHaveValue('collaboration.ts')
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('textbox', { name: '代码块名称', exact: true })).toHaveValue('example.ts')
    await expect(page.locator('[data-diff-id="code-main"] code')).toContainText('远端文字')
  } finally { await remote.close() }
}

export async function verifyWorkspaceCodeBlocks(page, url, screenshot) {
  await page.goto(url)
  await page.evaluate(content => {
    window.workspaceFixture.preferences.resetReading()
    const base = structuredClone(content); base.content[1].attrs.language = 'javascript'
    base.content[1].attrs.title = 'example.js'
    base.content[1].content[0].text = base.content[1].content[0].text.replace('42', '1')
    window.workspaceFixture.setComparison(base, content)
  }, codeDocument)
  const target = page.locator('.tiptap [data-diff-id="code-main"]')
  await expect(target).toHaveAttribute('data-code-highlight', 'ready')
  await page.evaluate(() => {
    const p = window.workspaceFixture.preferences
    p.setFont('code', 'Consolas'); p.setFontSize('paragraph', 20); p.setLineHeight(2)
    p.setTextColor('paragraph', 'light', '#334455'); p.setDocumentWidth(720)
  })
  await expect(target.locator('pre')).toHaveCSS('font-size', '18.8px')
  await expect(target.locator('pre')).toHaveCSS('line-height', '37.6px')
  await expect(target.locator('.requirement-code-token').first()).toHaveCSS('color', 'rgb(51, 68, 85)')
  expect(await target.locator('code').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Consolas')
  await expect(target.locator('.requirement-code-block__header')).toHaveCSS('font-size', '12px')
  await page.evaluate(() => window.workspaceFixture.preferences.resetReading())
  // 代码块沿用文字标注能力，高亮装饰不能改变选区定位。
  await page.locator('.tiptap').evaluate(element => {
    element.editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === 'code-main') element.editor.commands.setTextSelection({ from: pos + 1, to: pos + 10 }) })
  })
  await page.getByRole('button', { name: '添加 AI 标注', exact: true }).click()
  await page.getByRole('textbox', { name: '标注修改要求' }).fill('核对代码语言')
  await page.getByRole('button', { name: '保存标注', exact: true }).click()
  await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
  await language(page, target, 'JavaScript')
  await expect(target.locator('code')).toHaveClass(/language-javascript/)
  await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
  await select(page, 'code-main'); await page.keyboard.press('Control+z')
  await expect(target.locator('code')).toHaveClass(/language-typescript/)
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.diff-block .requirement-code-block__language').first()).toHaveText('JavaScript')
  await expect(page.locator('.diff-block .requirement-code-block__language').last()).toHaveText('TypeScript')
  await expect(page.locator('.diff-block .requirement-code-block__name').first()).toHaveText('example.js')
  await expect(page.locator('.diff-block .requirement-code-block__name').last()).toHaveText('example.ts')
  await expect(page.locator('.diff-block .requirement-code-token')).toHaveCount(0)
  await expect(page.locator('.diff-block .diff-chunk--inserted').first()).toBeVisible()
  for (const value of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.bingTheme = value }, value)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      expect((await page.locator('.diff-block .requirement-code-block__header').first().boundingBox()).height).toBeGreaterThanOrEqual(52)
    }
    await screenshot(`req-31-diff-${value}`)
  }
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
  await settings.locator('.requirement-code-block').scrollIntoViewIfNeeded()
  await expect(settings.locator('.requirement-code-block')).toHaveAttribute('data-code-highlight', 'ready')
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  const token = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'code-main'), codeDocument)
  await page.goto(`${url}?selection=1&context=${token}`)
  await expect(page.locator('.selection-history-workspace .requirement-code-block__language').first()).toHaveText('TypeScript')
  await expect(page.locator('.selection-history-workspace .requirement-code-block__name').first()).toHaveText('example.ts')
  await expect(page.locator('.selection-history-workspace .requirement-code-token')).toHaveCount(0)
  console.log('通过：代码文字标注定位、Diff 颜色/语言、设置预览、个人排版优先和选区历史。')
}
