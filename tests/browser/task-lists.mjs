import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const item = (id, text, checked = false) => ({ type: 'taskItem', attrs: { diffId: id, checked }, content: [p(`${id}-p`, text)] })
export const taskDocument = { type: 'doc', content: [
  { type: 'taskList', attrs: { diffId: 'tasks' }, content: [
    { ...item('first', '完成验收：长文字需要在窄屏下正常换行，并且复选框始终对齐首行。'), content: [
      p('first-p', '完成验收：长文字需要在窄屏下正常换行，并且复选框始终对齐首行。'),
      { type: 'taskList', attrs: { diffId: 'nested-list' }, content: [item('nested', '嵌套任务', true)] },
    ] }, item('second', '上线检查', true),
  ] }, p('tail'),
] }
async function select(page, id, offset = 1) {
  await page.locator('.tiptap').evaluate((el, { id, offset }) => {
    el.editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === id) el.editor.commands.setTextSelection(pos + offset) })
    el.editor.view.focus()
  }, { id, offset })
}
async function screenshot(page, name) {
  if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
  await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`), fullPage: true })
}
async function theme(page, value) {
  await page.emulateMedia({ colorScheme: value })
  await page.evaluate(value => { document.documentElement.dataset.bingTheme = value }, value)
}
async function geometry(page, selector) {
  await expect(async () => {
    const rows = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
      const checkbox = node.querySelector(':scope > .requirement-task-checkbox')
      const content = node.querySelector(':scope > .requirement-task-item__content')
      const text = content?.querySelector('p')
      if (!checkbox || !text) return null
      const box = checkbox.getBoundingClientRect(), line = text.getBoundingClientRect(), style = getComputedStyle(text)
      const probe = document.createElement('span')
      probe.style.color = 'var(--rb-muted)'; document.body.append(probe)
      const muted = getComputedStyle(probe).color
      probe.remove()
      return { size: box.width, height: box.height, align: Math.abs(box.y + box.height / 2 - line.y - parseFloat(style.lineHeight) / 2),
        gap: line.x - box.right, overflow: node.scrollWidth - node.clientWidth, decoration: style.textDecorationLine, checked: node.dataset.checked === 'true', color: style.color, muted }
    }).filter(Boolean))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.size).toBe(16); expect(row.height).toBe(16); expect(row.align).toBeLessThan(1)
      expect(row.gap).toBe(8)
      expect(row.overflow).toBeLessThanOrEqual(1); expect(row.decoration).not.toContain('line-through')
      if (row.checked) expect(row.color).toBe(row.muted)
    }
  }).toPass({ timeout: 5000 })
}

async function customTypography(page, selector) {
  const original = await page.evaluate(() => {
    const root = document.documentElement
    const state = { style: root.getAttribute('style'), sizes: root.dataset.editorSizes, colors: root.dataset.editorColors, line: root.dataset.editorLineHeight }
    root.dataset.editorSizes = 'paragraph'; root.dataset.editorColors = 'paragraph'; root.dataset.editorLineHeight = ''
    root.style.setProperty('--rb-editor-paragraph-size', '22px')
    root.style.setProperty('--rb-editor-paragraph-color', '#8844aa')
    root.style.setProperty('--rb-editor-line-height', '2.2')
    return state
  })
  try { await geometry(page, selector) } finally {
    await page.evaluate(state => {
      const root = document.documentElement
      if (state.style === null) root.removeAttribute('style'); else root.setAttribute('style', state.style)
      for (const [name, value] of Object.entries({ editorSizes: state.sizes, editorColors: state.colors, editorLineHeight: state.line })) {
        if (value === undefined) delete root.dataset[name]; else root.dataset[name] = value
      }
    }, original)
  }
}

export async function verifyEditorTaskLists(page) {
  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'start' } }] }), { collaborative })
    await select(page, 'start')
    await page.getByRole('button', { name: '任务清单', exact: true }).click()
    await page.keyboard.insertText('验收任务')
    let checkbox = page.locator('.tiptap').getByRole('checkbox').first()
    const before = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await checkbox.click(); await expect(checkbox).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.insertText('后续')
    await page.keyboard.press('Control+z'); await expect(page.locator('.tiptap')).toContainText('验收任务')
    await expect(checkbox).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Control+z'); await expect(checkbox).toHaveAttribute('aria-checked', 'false')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before)
    await checkbox.focus(); await page.keyboard.press('Space')
    await expect(checkbox).toHaveAttribute('aria-checked', 'true')
    expect(await checkbox.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
    await select(page, 'start', 5)
    await page.keyboard.press('Enter'); await page.keyboard.insertText('第二项')
    await page.keyboard.press('Tab')
    await expect(page.locator('.tiptap ul[data-type="taskList"]')).toHaveCount(2)
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('.tiptap ul[data-type="taskList"]')).toHaveCount(1)
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter')
    const exitState = await page.evaluate(() => ({ active: window.editorFixture.editor().isActive('taskList'), json: window.editorFixture.editor().getJSON(), selection: window.editorFixture.editor().state.selection.toJSON() }))
    expect(exitState.active, JSON.stringify(exitState)).toBe(false)
    for (const syntax of ['[] ', '[ ] ', '[x] ']) {
      await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'start' } }] }), { collaborative })
      await select(page, 'start'); await page.keyboard.type(syntax)
      checkbox = page.locator('.tiptap').getByRole('checkbox').first()
      await expect(checkbox).toHaveAttribute('aria-checked', String(syntax.includes('x')))
      await page.keyboard.insertText('中文任务')
    }
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ceshi', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.insertText', { text: '测试' }); await cdp.detach()
    await expect(page.locator('.tiptap')).toContainText('中文任务测试')
    await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'start' } }] }), { collaborative })
    await select(page, 'start'); await page.keyboard.type('/task'); await page.keyboard.press('Enter')
    await expect(page.locator('.tiptap').getByRole('checkbox')).toHaveCount(1)
    await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'start' } }] }), { collaborative })
    await page.evaluate(() => navigator.clipboard.writeText('- [ ] 未完成\n  - [x] 嵌套完成\n- [x] 完成'))
    await select(page, 'start'); await page.keyboard.press('Control+v')
    await expect(page.locator('.tiptap').getByRole('checkbox')).toHaveCount(3)
    expect(await page.evaluate(() => window.editorFixture.editor().getMarkdown())).toContain('- [x] 嵌套完成')
    await page.evaluate(() => { window.editorFixture.editor().commands.selectAll(); window.editorFixture.editor().view.focus() })
    await page.keyboard.press('Control+c')
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('嵌套完成'); expect(copied).not.toMatch(/\[[ x]\]/)
    const original = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await expect(page.locator('.tiptap').getByRole('checkbox')).toHaveCount(0)
    await page.locator('.tiptap .requirement-task-checkbox').first().click()
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(original)
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await expect(page.locator('.tiptap').getByRole('checkbox')).toHaveCount(3)
    await page.evaluate(() => window.editorFixture.setActive(false))
    await expect(page.locator('.tiptap button.requirement-task-checkbox')).toHaveCount(0)
  }
  await page.evaluate(content => window.editorFixture.mount(false, content), taskDocument)
  for (const mode of ['light', 'dark']) {
    await theme(page, mode)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await geometry(page, '.tiptap .requirement-task-item')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await screenshot(page, `req-35-editor-${mode}-${width}`)
    }
  }
  await customTypography(page, '.tiptap .requirement-task-item')
  await page.evaluate(content => window.editorFixture.mountRevision(content), taskDocument)
  await expect(page.locator('.tiptap .requirement-task-item')).toHaveCount(3)
  await expect(page.locator('.tiptap button.requirement-task-checkbox')).toHaveCount(0)
  await geometry(page, '.tiptap .requirement-task-item')
  await page.evaluate(content => window.editorFixture.mount(true, content), taskDocument)
  const remote = await page.context().newPage()
  try {
    await remote.goto(page.url()); await remote.waitForFunction(() => window.editorFixture)
    const state = await page.evaluate(() => window.editorFixture.collaborationState())
    await remote.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content: taskDocument, state })
    await select(remote, 'first-p'); await remote.keyboard.insertText('远端输入')
    await page.locator('[data-diff-id="first"] > .requirement-task-checkbox').click()
    const [left, right] = await Promise.all([page.evaluate(() => window.editorFixture.collaborationState()), remote.evaluate(() => window.editorFixture.collaborationState())])
    await page.evaluate(state => window.editorFixture.receiveState(state), right)
    await remote.evaluate(state => window.editorFixture.receiveState(state), left)
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(await remote.evaluate(() => window.editorFixture.editor().getJSON()))
    await select(page, 'first-p'); await page.keyboard.press('Control+z')
    await expect(page.locator('[data-diff-id="first"]')).toHaveAttribute('data-checked', 'false')
    await expect(page.locator('[data-diff-id="first-p"]')).toContainText('远端输入')
  } finally { await remote.close() }
  await theme(page, 'light')
  console.log('通过：任务清单工具栏/斜杠/输入规则/GFM、勾选撤销、嵌套键盘、中文组词、复制、只读、亮暗窄屏和双页 Yjs。')
}

export async function verifyWorkspaceTaskLists(page, url, capture) {
  await page.goto(url)
  // 单行正文与任务项修改的行高由内容决定，状态符号与回退入口不叠加占位。
  await page.evaluate(({ base, target }) => window.workspaceFixture.setComparison(base, target), {
    base: { type: 'doc', content: [p('compact-text', '单行正文'), { type: 'taskList', attrs: { diffId: 'compact-list' }, content: [item('compact-task', '单行任务')] }, p('compact-deleted', '删除一行'), p('compact-anchor', '未改正文')] },
    target: { type: 'doc', content: [p('compact-text', '单行正文修改'), { type: 'taskList', attrs: { diffId: 'compact-list' }, content: [item('compact-task', '单行任务', true)] }, p('compact-anchor', '未改正文'), p('compact-added', '新增一行')] },
  })
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.rich-diff__row--modified')).toHaveCount(2)
  const extraRowHeight = () => page.locator('.rich-diff__row--modified').evaluateAll(rows => Math.max(...rows.map(row => {
    const contentHeights = Array.from(row.querySelectorAll('.diff-block:not(.diff-block--missing)')).map(block => {
      const style = getComputedStyle(block)
      return block.firstElementChild.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    })
    return row.getBoundingClientRect().height - Math.max(...contentHeights)
  })))
  await expect.poll(extraRowHeight).toBeLessThan(1)
  const compactTask = page.locator('.rich-diff__row').filter({ hasText: '单行任务' })
  const status = compactTask.getByRole('img', { name: '修改', exact: true })
  const revert = compactTask.getByRole('button', { name: '回退此更改', exact: true })
  await page.mouse.move(0, 0)
  await expect(status).toHaveCSS('opacity', '1')
  await compactTask.hover()
  await expect(revert).toHaveCSS('opacity', '1')
  await expect(status).toHaveCSS('opacity', '0')
  await expect.poll(extraRowHeight).toBeLessThan(1)
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = true })
  await expect(page.locator('.rich-diff__revert')).toHaveCount(0)
  await expect(status).toHaveCSS('opacity', '1')
  await expect.poll(extraRowHeight).toBeLessThan(1)
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = false })
  await revert.focus()
  await page.mouse.move(0, 0)
  await expect(revert).toHaveCSS('opacity', '1')
  await expect(status).toHaveCSS('opacity', '0')
  await revert.press('Enter')
  await expect(page.locator('.rich-diff__row--modified')).toHaveCount(1)
  await page.evaluate(content => {
    const base = structuredClone(content)
    base.content[0].content[0].content[1].content[0].attrs.checked = false
    window.workspaceFixture.setComparison(base, content)
  }, taskDocument)
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.diff-block--modified').getByRole('img', { name: '已勾选', exact: true }).first()).toBeVisible()
  await expect(page.locator('.diff-block--modified').getByRole('img', { name: '未勾选', exact: true }).first()).toBeVisible()
  await expect(page.locator('.diff-block').getByText(/^(已勾选|取消勾选|未勾选)$/)).toHaveCount(0)
  await expect(page.locator('.diff-block button.requirement-task-checkbox')).toHaveCount(0)
  await expect(page.getByLabel('Diff 统计').getByTitle('修改 1 处', { exact: true })).toBeVisible()
  for (const mode of ['light', 'dark']) {
    await theme(page, mode)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await geometry(page, '.diff-block .requirement-task-item')
      await capture(`req-35-diff-${mode}-${width}`)
    }
  }
  await customTypography(page, '.diff-block .requirement-task-item')
  await page.getByRole('button', { name: '回退此更改', exact: true }).click()
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  await expect(page.locator('[data-diff-id="nested"]')).toHaveAttribute('data-checked', 'false')
  await select(page, 'nested-p')
  await page.evaluate(() => {
    const editor = document.querySelector('.tiptap').editor, from = editor.state.selection.from
    editor.commands.setTextSelection({ from, to: from + 2 })
  })
  await page.locator('.requirement-editor__toolbar').getByRole('button', { name: '添加 AI 标注', exact: true }).click()
  await page.getByRole('textbox', { name: '标注修改要求' }).fill('补充任务验收')
  await page.getByRole('button', { name: '保存标注', exact: true }).click()
  await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
  await page.locator('[data-diff-id="nested"] > .requirement-task-checkbox').click()
  await expect(page.getByRole('dialog', { name: '修改标注原文', exact: true })).toBeHidden()
  await expect(page.locator('.ai-annotations__card')).toHaveCount(1)
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = true })
  await expect(page.locator('.tiptap button.requirement-task-checkbox')).toHaveCount(0)
  await page.evaluate(() => { window.workspaceFixture.draft.readOnly.value = false })
  const token = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'first'), taskDocument)
  await page.goto(`${url}?selection=1&context=${token}`)
  await expect(page.locator('.selection-history-workspace .requirement-task-checkbox').first()).toBeVisible()
  await expect(page.locator('.selection-history-workspace').getByText(/^(已勾选|取消勾选|未勾选)$/)).toHaveCount(0)
  await expect(page.locator('.selection-history-workspace button.requirement-task-checkbox')).toHaveCount(0)
  const partialToken = await page.evaluate(content => {
    const start = Array.from(content.content[0].content[0].content[0].content[0].text).length + 1
    return window.workspaceFixture.createSelectionContext(content, 'first', { start, end: start + 2 })
  }, taskDocument)
  await page.goto(`${url}?selection=1&context=${partialToken}`)
  const partial = page.locator('.selection-history-workspace .requirement-task-item').first()
  await expect(partial).toHaveAttribute('data-checked', 'true')
  await expect(partial.locator('.diff-block__text')).toHaveText('嵌套')
  await expect(page.locator('.selection-history-workspace button.requirement-task-checkbox')).toHaveCount(0)
  console.log('通过：单行 Diff 紧凑高度与回退交互、嵌套勾选状态、只读比较、亮暗窄屏、文字标注、锁定与选区历史。')
}
