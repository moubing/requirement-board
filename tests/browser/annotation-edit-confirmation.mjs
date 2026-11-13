import { expect } from '@playwright/test'

export async function verifyAnnotationEditConfirmation(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(url)
    await expect(page.locator('.tiptap')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const paragraph = id => page.locator(`[data-diff-id="${id}"]`).first()
    const first = paragraph('paragraph_0_0')
    const originalText = await first.textContent()
    const original = await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))
    const dialog = page.getByRole('dialog', { name: '修改标注原文', exact: true })
    async function select(id, start, end = start) {
      await paragraph(id).evaluate((element, { start, end }) => {
        element.closest('.tiptap').focus({ preventScroll: true })
        const range = document.createRange()
        range.setStart(element.firstChild, start); range.setEnd(element.firstChild, end)
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      }, { start, end })
    }
    async function add(id, start, end, comment) {
      await select(id, start, end)
      const menu = page.locator('.requirement-editor__selection-menu')
      await expect(menu).toBeVisible()
      await menu.getByRole('button', { name: '添加 AI 标注', exact: true }).click()
      await page.getByRole('textbox', { name: '标注修改要求' }).fill(comment)
      await page.getByRole('button', { name: '保存标注', exact: true }).click()
      await expect(page.locator('.annotation-composer')).toHaveCount(0)
    }
    async function unchanged() {
      expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)
      await expect(first).toHaveText(originalText)
      await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
      await expect(page.locator('.ai-annotations__error')).toHaveCount(0)
    }
    await add('paragraph_0_0', 0, 14, '保留这条标注直到确认')
    // 普通输入、删除和真实剪贴板粘贴均在正文写入前确认；取消后 JSON 和浏览器 DOM 一致。
    for (const edit of [
      () => page.keyboard.insertText('X'),
      () => page.keyboard.press('Backspace'),
      () => page.keyboard.press('Delete'),
      async () => { await page.evaluate(() => navigator.clipboard.writeText('粘贴内容')); await page.keyboard.press('Control+v') },
    ]) {
      await select('paragraph_0_0', 5)
      await edit()
      await expect(dialog).toContainText('如果继续输入会清除这个标注，你确认吗？')
      await unchanged()
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await unchanged()
      await expect(page.locator('.tiptap')).toBeFocused()
    }
    // Chromium 原生 IME：开始组词前确认，取消不留下拼音，确认后正常输入完整汉字。
    const cdp = await context.newCDPSession(page)
    await select('paragraph_0_0', 5)
    await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 })
    await expect(dialog).toBeVisible()
    await unchanged()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await unchanged()
    await select('paragraph_0_0', 5)
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await expect(dialog).toBeVisible()
    await unchanged()
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(first).toHaveText(originalText)
    await expect(page.locator('.tiptap')).toBeFocused()
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '中文' })
    await expect(first).toHaveText(`${originalText.slice(0, 5)}中文${originalText.slice(5)}`)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
    await expect(page.locator('.annotation-overlay__pin')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(first).toHaveText(originalText)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
    await cdp.detach()
    await page.reload()
    await expect(page.locator('.tiptap')).toBeVisible()
    await page.getByRole('tab', { name: 'AI 标注', exact: true }).click()
    await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
    // 一次替换影响多条时只确认一次，清除对应本机记录，其他标注继续可定位。
    await add('paragraph_0_0', 0, 14, '受影响一')
    await add('paragraph_0_0', 16, 26, '受影响二')
    await add('paragraph_0_1', 0, 14, '其他标注保留')
    await select('paragraph_0_0', 0, 27)
    await page.keyboard.insertText('替换选区')
    await expect(dialog).toContainText('如果继续输入会清除这 2 个标注，你确认吗？')
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(first).toHaveText(`替换选区${originalText.slice(27)}`)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
    await expect(page.locator('.ai-annotations__comment')).toHaveText('其他标注保留')
    await select('paragraph_0_2', 5)
    await page.keyboard.insertText('无关修改')
    await expect(paragraph('paragraph_0_2')).toContainText('无关修改')
    await expect(dialog).toHaveCount(0)
    // 窄屏暗色确认及 Escape 取消仍保留正文与剩余标注。
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => document.documentElement.setAttribute('data-bing-theme', 'dark'))
    await select('paragraph_0_1', 5)
    await page.keyboard.insertText('Q')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(paragraph('paragraph_0_1')).not.toContainText('Q')
    expect(errors).toEqual([])
    console.log('标注原文编辑确认无头验证通过：输入/删除/粘贴取消无副作用、原生中文组词、确认只执行一次、撤销、清除记录持久化、多标注与无关编辑、窄屏暗色和 Escape。')
  } finally { await context.close() }
}
