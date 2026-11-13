import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const details = (id, summary, content) => ({ type: 'details', attrs: { diffId: id }, content: [
  { type: 'detailsSummary', attrs: { diffId: `${id}-summary` }, content: [{ type: 'text', text: summary }] },
  { type: 'detailsContent', content },
] })
export const detailsDocument = { type: 'doc', content: [
  p('intro', '补充内容默认收起，展开不改变文档。'),
  details('outer', '调研记录与补充说明：长摘要在窄屏中正常换行', [
    { type: 'heading', attrs: { diffId: 'chapter', level: 2 }, content: [{ type: 'text', text: '折叠中的章节' }] },
    p('inside', '只有展开才能阅读的补充正文'),
    details('nested', '嵌套日志', [p('deep', '深层查找目标'), { type: 'codeBlock', attrs: { diffId: 'code', language: null }, content: [{ type: 'text', text: 'console.log("details")' }] }]),
    { type: 'table', attrs: { diffId: 'table' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { diffId: 'cell' }, content: [p('cell-text', '表格内容')] }] }] },
  ]), p('tail', '正文继续'),
] }
const node = (page, id) => page.locator(`.tiptap [data-diff-id="${id}"]`)
const toggle = (page, id) => node(page, id).locator(':scope > button')
async function select(page, id) {
  await node(page, id).evaluate(el => {
    const editor = el.closest('.tiptap').editor
    editor.state.doc.descendants((n, pos) => { if (n.attrs.diffId === el.dataset.diffId) editor.commands.setTextSelection(pos + 1) })
    editor.view.focus()
  })
}
async function screenshot(page, name) {
  if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
  await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`), fullPage: true })
}
const snapshot = page => page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), model: window.editorFixture.modelUpdates, local: window.editorFixture.localUpdates }))

export async function verifyEditorDetails(page) {
  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'start' } }] }), { collaborative })
    await select(page, 'start')
    await page.keyboard.type('/details'); await page.keyboard.press('Enter')
    await expect(page.locator('.tiptap .requirement-details')).toHaveCount(1)
    await page.keyboard.press('Control+z'); await expect(page.locator('.tiptap .requirement-details')).toHaveCount(0)
    await page.keyboard.press('Control+y'); await expect(page.locator('.tiptap .requirement-details')).toHaveCount(1)
    const summary = page.locator('.tiptap summary')
    expect(await summary.evaluate(el => getComputedStyle(el, '::before').content)).toBe('"折叠块标题"')
    await summary.click(); await page.keyboard.insertText('中文摘要')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '测试' }); await cdp.detach()
    await expect(summary).toHaveText('中文摘要测试')
    // 收起摘要的 Enter 应续写在容器之后，不能把光标送入不可见内容。
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.depth)).toBe(1)
    await page.locator('.tiptap .requirement-details__toggle').click()
    await expect(page.locator('.tiptap .requirement-details__toggle')).toHaveAttribute('aria-expanded', 'true')
    await summary.click({ position: { x: 48, y: 14 } })
    await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('detailsSummary')
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('paragraph')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.depth)).toBe(3)
    // 尾部空段有 diffId 时仍能用 Enter 离开内容区。
    await select(page, 'start'); await page.keyboard.press('Enter')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.depth)).toBe(1)
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content: detailsDocument })
    const before = await snapshot(page)
    await select(page, 'outer-summary'); await page.keyboard.press('End')
    await expect.poll(() => page.evaluate(() => {
      const { $from } = window.editorFixture.editor().state.selection
      return $from.parentOffset === $from.parent.content.size
    })).toBe(true)
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.attrs.diffId)).toBe('tail')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'false')
    await toggle(page, 'outer').focus(); await page.keyboard.press('Space')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'false')
    // 浏览器原生 beforematch 揭示路径：嵌套目标必须展开所有祖先。
    await node(page, 'nested').locator(':scope > div > [data-type="detailsContent"]').dispatchEvent('beforematch')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle(page, 'nested')).toHaveAttribute('aria-expanded', 'true')
    expect(await snapshot(page)).toEqual(before)
    await toggle(page, 'outer').click()
    // window.find 可验证隐藏文字参与查找，但不会像浏览器查找面板那样发送 beforematch。
    const found = await page.evaluate(() => { window.getSelection()?.removeAllRanges(); return window.find('深层查找目标', false, false, true) })
    expect(found).toBe(true)
    await node(page, 'outer').locator(':scope > div > [data-type="detailsContent"]').dispatchEvent('beforematch')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
    expect(await snapshot(page)).toEqual(before)
    await page.evaluate(() => window.editorFixture.setActive(false))
    await page.evaluate(() => window.editorFixture.setActive(true))
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await toggle(page, 'outer').click(); await toggle(page, 'outer').click()
    expect(await snapshot(page)).toEqual(before)
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await select(page, 'inside'); await page.keyboard.insertText('新增')
    await page.keyboard.press('Control+z'); expect((await snapshot(page)).json).toEqual(before.json)
    await page.evaluate(() => { window.editorFixture.editor().commands.selectAll(); window.editorFixture.editor().view.focus() })
    await page.keyboard.press('Control+c')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('深层查找目标')
    await select(page, 'outer-summary')
    await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
    await page.getByRole('menuitem', { name: '组件块', exact: true }).hover()
    await page.getByRole('menuitem', { name: '取消折叠块', exact: true }).click()
    await expect(node(page, 'outer')).toHaveCount(0)
    await expect(node(page, 'inside')).toContainText('补充正文')
  }
  await page.evaluate(content => window.editorFixture.mount(false, content), detailsDocument)
  await toggle(page, 'outer').click(); await toggle(page, 'nested').click()
  for (const mode of ['light', 'dark']) for (const width of [320, 390, 960, 1440]) {
    await page.emulateMedia({ colorScheme: mode })
    await page.evaluate(mode => { document.documentElement.dataset.bingTheme = mode }, mode)
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const geometry = await node(page, 'outer').evaluate(el => {
      const summary = el.querySelector('summary'), button = el.querySelector('button')
      return { weight: getComputedStyle(summary).fontWeight, gap: summary.getBoundingClientRect().x + parseFloat(getComputedStyle(summary).paddingLeft) - button.getBoundingClientRect().right }
    })
    expect(geometry.weight).toBe('600'); expect(geometry.gap).toBeGreaterThanOrEqual(2)
    await screenshot(page, `req-36-editor-${mode}-${width}`)
  }
  await page.evaluate(content => window.editorFixture.mountRevision(content), detailsDocument)
  await toggle(page, 'outer').click(); await expect(node(page, 'inside')).toBeVisible()
  expect(await page.locator('.tiptap').getAttribute('contenteditable')).toBe('false')
  await page.evaluate(content => window.editorFixture.mount(true, content), detailsDocument)
  const remote = await page.context().newPage()
  try {
    await remote.goto(page.url()); await remote.waitForFunction(() => window.editorFixture)
    const state = await page.evaluate(() => window.editorFixture.collaborationState())
    await remote.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content: detailsDocument, state })
    await toggle(page, 'outer').click(); await select(page, 'inside'); await page.keyboard.insertText('协作输入')
    await remote.evaluate(state => window.editorFixture.receiveState(state), await page.evaluate(() => window.editorFixture.collaborationState()))
    expect((await snapshot(remote)).json).toEqual((await snapshot(page)).json)
    await expect(toggle(remote, 'outer')).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Control+z')
    await expect(node(page, 'inside')).not.toContainText('协作输入')
  } finally { await remote.close() }
  console.log('通过：折叠块创建/取消、键盘/IME、只读、嵌套 beforematch、状态不入正文/Yjs、撤销、剪贴板与亮暗窄屏。')
}

export async function verifyWorkspaceDetails(page, url, capture) {
  await page.goto(url)
  await page.waitForFunction(() => window.workspaceFixture)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(content => window.workspaceFixture.setComparison(content, structuredClone(content)), detailsDocument)
  const before = await page.locator('.tiptap').evaluate(el => el.editor.getJSON())
  await page.getByRole('button', { name: '定位到标题：折叠中的章节', exact: true }).click()
  await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
  await toggle(page, 'outer').click()
  await page.evaluate(() => { window.workspaceFixture.route.query = { block: 'chapter' } })
  await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
  await select(page, 'inside')
  await page.locator('.tiptap').evaluate(el => { const from = el.editor.state.selection.from; el.editor.commands.setTextSelection({ from, to: from + 4 }) })
  await page.locator('.requirement-editor__toolbar').getByRole('button', { name: '添加 AI 标注', exact: true }).click()
  await page.getByRole('textbox', { name: '标注修改要求' }).fill('补充说明')
  await page.getByRole('button', { name: '保存标注', exact: true }).click()
  await toggle(page, 'outer').click()
  await expect(page.locator('.annotation-overlay__highlight')).toHaveCount(0)
  await page.getByRole('button', { name: '定位标注 1', exact: true }).click()
  await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
  expect(await page.locator('.tiptap').evaluate(el => el.editor.getJSON())).toEqual(before)
  // 修改摘要和嵌套段落，比较中同时完整展示并保留内部身份。
  await page.evaluate(content => {
    const target = structuredClone(content)
    target.content[1].content[0].content[0].text = '修改后的摘要'
    target.content[1].content[1].content[2].content[1].content[0].content[0].text += '，新增日志'
    window.workspaceFixture.setComparison(content, target)
  }, detailsDocument)
  await toggle(page, 'outer').click()
  await page.getByRole('button', { name: '定位下一处正文修改', exact: true }).click()
  await expect(toggle(page, 'outer')).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.requirement-details--diff').first()).toBeVisible()
  await expect(page.locator('.requirement-details__content').getByText('深层查找目标', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.requirement-details--diff button.requirement-details__toggle')).toHaveCount(0)
  for (const mode of ['light', 'dark']) for (const width of [320, 390, 960, 1440]) {
    await page.emulateMedia({ colorScheme: mode })
    await page.evaluate(mode => { document.documentElement.dataset.bingTheme = mode }, mode)
    await page.setViewportSize({ width, height: 1000 })
    await capture(`req-36-diff-${mode}-${width}`)
  }
  await page.getByRole('button', { name: '回退此更改', exact: true }).click()
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  expect(await page.locator('.tiptap').evaluate(el => el.editor.getJSON())).toEqual(before)
  const token = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'outer-summary'), detailsDocument)
  await page.goto(`${url}?selection=1&context=${token}`)
  await expect(page.locator('.selection-history-workspace .requirement-details__summary').first()).toContainText('调研记录')
  console.log('通过：折叠块目录/章节链接/AI 标注/版本标记定位、完整嵌套比较、回退与选区历史。')
}
