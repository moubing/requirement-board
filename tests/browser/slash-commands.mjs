import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const doc = (text = '') => ({ type: 'doc', content: [p('target', text), p('tail', '后续正文')] })
const menu = page => page.getByRole('menu', { name: '插入正文块', exact: true })
async function select(page, id = 'target', offset = 1) {
  await page.evaluate(({ id, offset }) => {
    const e = window.editorFixture.editor()
    e.state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) e.commands.setTextSelection(pos + offset) })
    e.view.focus()
  }, { id, offset })
}
async function mount(page, collaborative, content = doc()) {
  await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content })
  await select(page)
}
const json = page => page.evaluate(() => window.editorFixture.editor().getJSON())
async function expectBodyBelowToolbar(page) {
  await expect.poll(async () => {
    const toolbar = await page.getByLabel('编辑器工具栏', { exact: true }).boundingBox()
    const viewport = await page.getByRole('region', { name: '文档正文', exact: true }).boundingBox()
    return Math.abs(viewport.y - toolbar.y - toolbar.height)
  }, '命令菜单打开或关闭时均不应在工具栏和正文之间占位').toBeLessThanOrEqual(1)
}

export async function verifySlashCommands(page) {
  // Playwright 异步启用文件窗口拦截。提前保持监听，避免 waitForEvent 后立即按 Enter
  // 时拦截尚未生效，导致无头 Chromium 直接取消选图；每个用例仍等待真实 filechooser。
  const keepFileChooserInterception = () => {}
  page.on('filechooser', keepFileChooserInterception)
  try {
    await verifySlashCommandInteractions(page)
  } finally {
    page.off('filechooser', keepFileChooserInterception)
  }
}

async function verifySlashCommandInteractions(page) {
  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await mount(page, collaborative)
    await expectBodyBelowToolbar(page)
    const baseline = await json(page)
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await expectBodyBelowToolbar(page)
    await expect(menu(page).getByRole('menuitem', { name: /一级标题/ })).toBeVisible()
    expect(await page.evaluate(() => document.activeElement === window.editorFixture.editor().view.dom)).toBe(true)
    await page.waitForTimeout(650)
    await page.keyboard.type('h2')
    await expect(menu(page).getByRole('menuitem')).toHaveCount(1)
    await page.keyboard.press('Tab')
    await expect(menu(page)).toBeHidden()
    await expectBodyBelowToolbar(page)
    await expect(page.locator('.tiptap h2')).toHaveCount(1)
    await page.keyboard.press('Control+z')
    expect(await json(page)).toEqual(baseline)
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('.tiptap h2')).toHaveCount(1)
    await page.keyboard.insertText('新标题')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.tiptap h2')).toHaveText('')
    await page.keyboard.press('Control+z')
    expect(await json(page)).toEqual(baseline)

    for (const [query, selector] of [['ul', 'ul'], ['ol', 'ol'], ['quote', 'blockquote'], ['建议', '[data-tone="tip"]'], ['code', 'pre'], ['hr', 'hr'], ['table', 'table']]) {
      await mount(page, collaborative)
      const before = await json(page)
      await page.keyboard.insertText('/')
      await expect(menu(page)).toBeVisible()
      await page.keyboard.insertText(query)
      await page.keyboard.press('Enter')
      await expect(page.locator(`.tiptap ${selector}`)).toHaveCount(1)
      if (query === 'table') { await expect(page.locator('.tiptap th')).toHaveCount(3); await expect(page.locator('.tiptap td')).toHaveCount(6) }
      await page.keyboard.press('Control+z')
      expect(await json(page)).toEqual(before)
    }

    for (const trigger of ['／', '、']) {
      await mount(page, collaborative)
      await page.keyboard.insertText(trigger)
      await expect(menu(page)).toBeVisible()
      const before = await json(page)
      await page.keyboard.press('Escape')
      await expect(menu(page)).toBeHidden()
      expect(await json(page)).toEqual(before)
      await page.keyboard.insertText('继续')
      await expect(menu(page)).toBeHidden()
    }
    for (const [text, trigger] of [['正文', '/'], ['正文 ', '、'], [' ', '、'], ['https:', '/']]) {
      await mount(page, collaborative, doc(text)); await select(page, 'target', text.length + 1)
      await page.keyboard.insertText(trigger)
      await expect(menu(page)).toBeHidden()
    }
    await mount(page, collaborative, doc('正文 ')); await select(page, 'target', 4)
    await page.keyboard.type('/nomatch')
    await expect(menu(page).getByText('没有匹配的命令')).toBeVisible()
    const unmatched = await json(page)
    await page.keyboard.press('Enter')
    expect(await json(page)).toEqual(unmatched)
    await page.keyboard.press('Escape')
    expect(await json(page)).toEqual(unmatched)
    await mount(page, collaborative)
    await page.keyboard.type('/')
    await page.keyboard.press('Backspace')
    await expect(menu(page)).toBeHidden()
    await page.keyboard.type('/')
    await page.locator('.tiptap [data-diff-id="tail"]').click()
    await expect(menu(page)).toBeHidden()
    expect((await json(page)).content[0].content[0].text).toBe('/')

    // 原生 Chromium IME：未触发时不新开菜单；已有菜单在组词中保持，提交后才筛选。
    await mount(page, collaborative)
    const imeBaseline = await json(page)
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.imeSetComposition', { text: 'dun', selectionStart: 3, selectionEnd: 3 })
      await expect(menu(page)).toBeHidden()
      await cdp.send('Input.insertText', { text: '、' })
      await expect(menu(page)).toBeVisible()
      await expect(menu(page).getByRole('menuitem')).toHaveCount(17)
      await page.keyboard.press('ArrowDown')
      const initialItems = await menu(page).getByRole('menuitem').allTextContents()
      const panel = await menu(page).elementHandle()
      for (const text of ['b', 'biao', 'biao ge']) {
        await cdp.send('Input.imeSetComposition', { text, selectionStart: 0, selectionEnd: text.length })
        await expect(menu(page)).toBeVisible()
        await expect(menu(page).getByRole('menuitem')).toHaveText(initialItems)
        expect(await panel.evaluate(el => el.isConnected)).toBe(true)
      }
      const composingText = await json(page)
      // CDP 没有系统候选窗口；这里只检查组词按键未被菜单拦截，不声称代替真实输入法。
      for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
        expect(await page.evaluate(key => window.editorFixture.editor().view.dom.dispatchEvent(
          new KeyboardEvent('keydown', { key, isComposing: true, keyCode: 229, bubbles: true, cancelable: true }),
        ), key)).toBe(true)
      }
      expect(await json(page)).toEqual(composingText)
      await expect(menu(page).getByRole('menuitem')).toHaveText(initialItems)
      await cdp.send('Input.insertText', { text: '表格' })
      await expect(menu(page)).toBeVisible()
      await expect(menu(page).getByRole('menuitem')).toHaveCount(1)
      await page.keyboard.press('Enter')
      await expect(page.locator('.tiptap table')).toHaveCount(1)
      await page.keyboard.press('Control+z')
      expect(await json(page)).toEqual(imeBaseline)
      await panel.dispose()

      await mount(page, collaborative)
      await page.keyboard.type('/')
      await expect(menu(page).getByRole('menuitem')).toHaveCount(initialItems.length)
      await cdp.send('Input.imeSetComposition', { text: 'tu', selectionStart: 2, selectionEnd: 2 })
      await expect(menu(page).getByRole('menuitem')).toHaveCount(initialItems.length)
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
      await expect(menu(page)).toBeVisible()
      await expect(menu(page).getByRole('menuitem')).toHaveCount(initialItems.length)
      expect((await json(page)).content[0].content[0].text).toBe('/')
      await page.keyboard.press('Escape')
      await expect(menu(page)).toBeHidden()
    } finally { await cdp.detach() }

    await mount(page, collaborative)
    await page.keyboard.type('/')
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await expect(menu(page)).toBeHidden()
    await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await select(page)
    await page.keyboard.type('/')
    await page.evaluate(() => window.editorFixture.setActive(false))
    await expect(menu(page)).toBeHidden()

    await mount(page, collaborative)
    const mouseBaseline = await json(page)
    await page.keyboard.type('/h1')
    await menu(page).getByRole('menuitem', { name: /一级标题/ }).click()
    await expect(page.locator('.tiptap h1')).toHaveCount(1)
    expect(await page.evaluate(() => document.activeElement === window.editorFixture.editor().view.dom)).toBe(true)
    await page.keyboard.press('Control+z')
    expect(await json(page)).toEqual(mouseBaseline)

    // 文件选择及异步插入共用现有上传占位；不继续输入时仍是一个完整撤销步骤。
    await mount(page, collaborative)
    const imageBaseline = await json(page)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf0kAAAAASUVORK5CYII=', 'base64')
    await page.evaluate(() => {
      window.slashOriginalFetch = window.$fetch
      window.$fetch = async (url, options) => (await fetch(url, options)).json()
    })
    await page.route('**/uploads/slash-image.png', route => route.fulfill({ contentType: 'image/png', body: bytes }))
    await page.route('**/api/assets/upload?*', route => route.fulfill({ json: { url: '/uploads/slash-image.png', fileName: 'slash.png' } }))
    try {
      await page.keyboard.type('/image')
      await expect(menu(page).getByRole('menuitem', { name: /图片/ })).toBeVisible()
      const choosing = page.waitForEvent('filechooser')
      await page.keyboard.press('Enter')
      const chooser = await choosing
      await page.evaluate(() => { const e = window.editorFixture.editor(); e.view.dispatch(e.state.tr) })
      await expect(menu(page)).toBeHidden()
      await chooser.setFiles({ name: 'slash.png', mimeType: 'image/png', buffer: bytes })
      await expect(page.locator('.tiptap img[src="/uploads/slash-image.png"]')).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.editorFixture.uploadState.uploading)).toBe(0)
      await page.keyboard.press('Control+z')
      expect(await json(page)).toEqual(imageBaseline)
    } finally {
      await page.unroute('**/api/assets/upload?*')
      await page.unroute('**/uploads/slash-image.png')
      await page.evaluate(() => { window.$fetch = window.slashOriginalFetch })
    }
  }

  await verifySlashMenuLayout(page)
  console.log('通过：斜杠触发、筛选、块插入、单步撤销、取消、IME、只读/隐藏与亮暗窄屏。')
}

export async function verifySlashMenuLayout(page) {
  for (const width of [320, 390, 960, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 750 })
    await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
    await mount(page, false)
    await expectBodyBelowToolbar(page)
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await expectBodyBelowToolbar(page)
    await page.waitForTimeout(350)
    const bounds = await menu(page).boundingBox()
    const viewport = await page.getByRole('region', { name: '文档正文', exact: true }).boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(viewport.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
    expect(bounds.y).toBeGreaterThanOrEqual(viewport.y)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1)
    // 循环键盘选择末项，内部滚动使当前项完整可见且正文焦点保留。
    await page.keyboard.press('ArrowUp')
    await expect(menu(page).getByRole('menuitem', { name: /图片/ })).toBeInViewport()
    if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
      await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `slash-${width}-${theme}.png`) })
    }
    await page.keyboard.press('Escape')
    await expect(menu(page)).toBeHidden()
    await expectBodyBelowToolbar(page)
  }
  // 光标靠近正文视口底部时向上展开；正文滚动后关闭，保留输入。
  await page.setViewportSize({ width: 960, height: 600 })
  await mount(page, false, { type: 'doc', content: [...Array.from({ length: 18 }, (_, i) => p(`row-${i}`, `正文 ${i}`)), p('target'), p('tail')] })
  await page.locator('.tiptap [data-diff-id="target"]').scrollIntoViewIfNeeded()
  await select(page)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.type('/')
  await expect(menu(page)).toBeVisible()
  await expect(menu(page)).toHaveClass(/is-placement-top/)
  await expect.poll(async () => {
    const bounds = await menu(page).boundingBox()
    const caretTop = await page.evaluate(() => { const e = window.editorFixture.editor(); return e.view.coordsAtPos(e.state.selection.from).top })
    return bounds.y + bounds.height <= caretTop
  }).toBe(true)
  await page.getByRole('region', { name: '文档正文', exact: true }).evaluate(el => { el.scrollTop = 0 })
  await expect(menu(page)).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 1000 })
  console.log('通过：320/390/960/1440px 亮暗布局、菜单开关不占用正文空间、局部边界与向上展开。')
}
