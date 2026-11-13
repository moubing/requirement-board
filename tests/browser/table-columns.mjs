import { expect } from '@playwright/test'

const paragraph = (id, text) => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
export const tableDocument = { type: 'doc', content: [paragraph('table-before', '表格列宽'),
  { type: 'table', attrs: { diffId: 'resize-table' }, content: [0, 1, 2].map(row => ({ type: 'tableRow', content: [0, 1, 2].map(column => ({
    type: row ? 'tableCell' : 'tableHeader', attrs: { diffId: `cell-${row}-${column}`, colwidth: [[140, 200, 360][column]] },
    content: [paragraph(`text-${row}-${column}`, row ? ['status', '选项', '这是一段较长的说明，用于核对拖动时的实时换行、光标位置与列宽。'][column] : ['字段', '类型', '说明'][column])],
  })) })) }, paragraph('table-after', '表格之后') ] }
const tableJson = page => page.evaluate(() => window.editorFixture.editor().getJSON().content.find(node => node.type === 'table'))
const json = page => page.evaluate(() => window.editorFixture.editor().getJSON())
async function boundary(page, index = 0) {
  const cell = page.locator('.tiptap tr').first().locator('th, td').nth(index)
  await cell.scrollIntoViewIfNeeded()
  const box = await cell.boundingBox()
  const point = { x: box.x + box.width - 1, y: box.y + box.height / 2 }
  await page.mouse.move(point.x, point.y)
  return point
}
async function begin(page, index = 0) {
  const point = await boundary(page, index)
  await expect(page.locator('.column-resize-handle').first()).toBeVisible()
  await expect(page.locator('.tiptap')).toHaveAttribute('data-bing-cursor', 'col-resize')
  await page.mouse.down()
  return point
}

export async function verifyEditorTableColumns(page) {
  const viewport = page.viewportSize()
  try {
    for (const collaborative of [false, true]) {
      await page.evaluate(({ content, collaborative }) => window.editorFixture.mount(collaborative, content), { content: tableDocument, collaborative })
      await page.locator('[data-diff-id="table-after"]').click(); await page.keyboard.press('End'); await page.keyboard.insertText('前')
      const before = await json(page)
      const updates = await page.evaluate(() => window.editorFixture.modelUpdates)
      const point = await begin(page)
      for (const delta of [15, 50, 90, 130, 75]) {
        await page.mouse.move(point.x + delta, point.y)
        expect((await page.locator('.tiptap col').first().boundingBox()).width).toBeCloseTo(140 + delta, 0)
        expect(await json(page)).toEqual(before)
      }
      expect(await page.evaluate(() => window.editorFixture.modelUpdates)).toBe(updates)
      await page.mouse.up()
      const resized = await json(page)
      expect((await tableJson(page)).content.every(row => row.content[0].attrs.colwidth[0] === 215)).toBe(true)
      expect(await page.evaluate(() => window.editorFixture.modelUpdates)).toBe(updates + 1)
      await page.keyboard.insertText('后'); await page.keyboard.press('Control+z')
      expect(await json(page)).toEqual(resized)
      await page.keyboard.press('Control+z'); expect(await json(page)).toEqual(before)
      await page.keyboard.press('Control+Shift+z'); expect(await json(page)).toEqual(resized)
      const atMin = await begin(page)
      await page.mouse.move(atMin.x - 300, atMin.y); await page.mouse.up()
      expect((await tableJson(page)).content[0].content[0].attrs.colwidth).toEqual([80])
      await page.keyboard.press('Control+z'); expect(await json(page)).toEqual(resized)
      // 每种取消入口都恢复 DOM 和数据，最后 mouseup 不补写事务。
      for (const ending of ['Escape', 'blur', 'hidden', 'inactive', 'locked']) {
        const point = await begin(page)
        await page.mouse.move(point.x + 60, point.y)
        if (ending === 'Escape') await page.keyboard.press('Escape')
        else await page.evaluate(ending => {
          if (ending === 'blur') window.dispatchEvent(new Event('blur'))
          if (ending === 'inactive') window.editorFixture.setActive(false)
          if (ending === 'locked') window.editorFixture.setDisabled(true)
          if (ending === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) }
        }, ending)
        await page.mouse.up()
        expect(await json(page)).toEqual(resized)
        expect((await page.locator('.tiptap col').first().boundingBox()).width).toBeCloseTo(215, 0)
        await page.evaluate(() => { delete document.hidden; window.editorFixture.setActive(true); window.editorFixture.setDisabled(false) })
      }
      const reset = await boundary(page)
      await page.mouse.dblclick(reset.x, reset.y)
      expect((await tableJson(page)).content.every(row => row.content[0].attrs.colwidth === null)).toBe(true)
      expect(await page.locator('.tiptap col').first().evaluate(col => col.style.width)).toBe('')
      await page.keyboard.press('Control+z'); expect(await json(page)).toEqual(resized)
      await page.evaluate(content => window.editorFixture.mountRevision(content), resized)
      await boundary(page)
      await expect(page.locator('.column-resize-handle')).toHaveCount(0)
      expect((await page.locator('.tiptap col').first().boundingBox()).width).toBeCloseTo(215, 0)
    }
    await verifyTableSync(page)
    // 普通动效下，拖动造成表内换行时光标逐帧跟随且常亮。
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(content => window.editorFixture.mount(false, content), tableDocument)
    await page.locator('[data-diff-id="table-after"]').click(); await page.keyboard.press('End')
    const point = await begin(page, 2)
    for (const delta of [-100, -200, -240, -100, 0]) {
      await page.mouse.move(point.x + delta, point.y)
      const metrics = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame)
        const editor = window.editorFixture.editor(), caret = document.querySelector('.requirement-editor__smooth-caret')
        return { lag: Math.abs(caret.getBoundingClientRect().top - editor.view.coordsAtPos(editor.state.selection.head).top - 1), opacity: Number(getComputedStyle(caret).opacity) }
      })
      expect(metrics.opacity).toBe(1); expect(metrics.lag).toBeLessThanOrEqual(2)
    }
    await page.mouse.up()
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 960, 1440]) {
      await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      if (width < 960) expect(await page.locator('.tableWrapper .requirement-node-scroll__viewport').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
    }
    const touch = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    try {
      const touchPage = await touch.newPage(); await touchPage.goto(page.url()); await touchPage.waitForFunction(() => window.editorFixture)
      await touchPage.evaluate(content => window.editorFixture.mount(false, content), tableDocument)
      await boundary(touchPage); await expect(touchPage.locator('.column-resize-handle')).toHaveCount(0)
    } finally { await touch.close() }
    // 卸载正在拖动的实例，旧的全局 mouseup 不能影响新编辑器。
    await page.setViewportSize(viewport)
    await begin(page)
    await page.evaluate(content => window.editorFixture.mount(false, content), tableDocument)
    const mounted = await json(page)
    await page.mouse.up(); expect(await json(page)).toEqual(mounted)
    console.log('通过：列宽实时预览、最小宽度、单次保存/独立撤销、取消清理、双击自动、只读/触屏、光标及亮暗窄屏。')
  } finally { await page.mouse.up(); await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' }) }
}

async function verifyTableSync(page) {
  await page.evaluate(content => window.editorFixture.mount(true, content), tableDocument)
  const remote = await page.context().newPage()
  try {
    await remote.goto(page.url()); await remote.waitForFunction(() => window.editorFixture)
    await remote.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content: tableDocument, state: await page.evaluate(() => window.editorFixture.collaborationState()) })
    const point = await begin(page, 1)
    await page.mouse.move(point.x + 80, point.y)
    await remote.locator('[data-diff-id="text-1-0"]').click()
    await remote.keyboard.insertText('远端文字')
    await remote.evaluate(() => window.editorFixture.editor().commands.addColumnBefore())
    await page.evaluate(state => window.editorFixture.receiveState(state), await remote.evaluate(() => window.editorFixture.collaborationState()))
    await page.mouse.up()
    await remote.evaluate(state => window.editorFixture.receiveState(state), await page.evaluate(() => window.editorFixture.collaborationState()))
    expect(await json(page)).toEqual(await json(remote))
    const table = await tableJson(page)
    expect(table.content.every(row => row.content.length === 4 && row.content[2].attrs.colwidth[0] === 280)).toBe(true)
    await page.keyboard.press('Control+z')
    const undone = await tableJson(page)
    expect(undone.content.every(row => row.content.length === 4 && row.content[2].attrs.colwidth[0] === 200)).toBe(true)
    expect(JSON.stringify(undone)).toContain('远端文字')
  } finally { await remote.close() }
}

export async function verifyWorkspaceTableColumns(page, url, screenshot) {
  await page.goto(url)
  await page.evaluate(content => window.workspaceFixture.setComparison(content, content), tableDocument)
  const first = page.locator('.tiptap [data-diff-id="cell-0-0"]')
  await expect(first).toBeVisible()
  // 正式版本与草稿均使用 schema 规范化后的 JSON，避免缺省属性造成额外格式差异。
  await page.evaluate(() => {
    const content = document.querySelector('.tiptap').editor.getJSON()
    window.workspaceFixture.setComparison(structuredClone(content), structuredClone(content))
  })
  for (const [id, label] of [['cell-0-0', '标注整张表格'], ['cell-1-0', '标注当前单元格']]) {
    await page.locator(`.tiptap [data-diff-id="${id}"]`).click({ button: 'right', position: { x: 20, y: 20 } })
    await page.getByText(label, { exact: true }).click()
    await page.getByRole('textbox', { name: '标注修改要求' }).fill('核对业务含义')
    await page.getByRole('button', { name: '保存标注', exact: true }).click()
  }
  await expect(page.locator('.ai-annotations__card')).toHaveCount(2)
  const point = await begin(page)
  await page.mouse.move(point.x + 80, point.y); await page.mouse.up()
  await expect(first).toHaveAttribute('colwidth', '220')
  await expect(page.getByRole('dialog', { name: '修改标注原文', exact: true })).toHaveCount(0)
  await expect(page.locator('.ai-annotations__card')).toHaveCount(2)
  await expect(page.locator('[data-version-marker="modified:resize-table"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '定位下一处正文修改' })).toHaveText('已修改 · 1 处')
  await screenshot('req-33-editor')
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.diff-block__column-change')).toHaveCount(2)
  await expect(page.locator('.diff-block__column-change').first()).toHaveText('列宽调整')
  await expect(page.locator('.diff-block--table .diff-chunk--inserted, .diff-block--table .diff-chunk--deleted')).toHaveCount(0)
  await expect(page.locator('.diff-block__table-cell--unchanged')).toHaveCount(12)
  await expect(page.locator('.column-resize-handle')).toHaveCount(0)
  const cols = page.locator('.diff-block__table col:first-child')
  const ratios = await cols.evaluateAll(nodes => nodes.map(node => parseFloat(node.style.width)))
  expect(ratios[1] / ratios[0]).toBeCloseTo(220 / 140, 4)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await expect(page.locator('.diff-block__table').first()).toBeVisible()
    }
    await screenshot(`req-33-diff-${theme}`)
  }
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
  const preview = settings.getByRole('region', { name: '表格排版预览', exact: true })
  await preview.scrollIntoViewIfNeeded()
  await expect(preview.locator('table')).toBeVisible()
  await expect(preview.locator('col').first()).toHaveCSS('width', '80px')
  await expect(preview.locator('.column-resize-handle')).toHaveCount(0)
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  console.log('通过：整表/单元格标注保持有效、修改标记、Diff 列宽比例/说明/无字符增删、设置预览及亮暗窄屏。')
}
