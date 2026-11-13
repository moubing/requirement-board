import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const tones = ['note', 'tip', 'warning', 'danger']
const labels = ['说明', '建议', '注意', '风险']
const placeholders = ['输入说明…', '输入建议…', '输入注意事项…', '输入风险…']
const p = (id, text) => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
export const calloutDocument = { type: 'doc', content: [...tones.map((tone, i) => ({ type: 'callout', attrs: { diffId: tone, tone }, content: [
  { type: 'text', text: `${labels[i]}：首先核对需求背景。` }, { type: 'hardBreak' },
  { type: 'text', text: '重要内容', marks: [{ type: 'highlight' }] }, { type: 'text', text: '与' },
  { type: 'text', text: '使用说明', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] },
  { type: 'text', text: '保持原有样式，较长内容在窄屏下自然换行。' },
] })), p('tail')] }

async function select(page, id, offset = 2) {
  await page.locator('.tiptap').evaluate((el, { id, offset }) => {
    const editor = el.editor
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.diffId === id) editor.commands.setTextSelection(pos + offset)
    })
    editor.view.focus()
  }, { id, offset })
}
async function theme(page, value) {
  await page.emulateMedia({ colorScheme: value })
  await page.evaluate(value => { document.documentElement.dataset.bingTheme = value }, value)
}
async function capture(page, name) {
  if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
  await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`), fullPage: true })
}
async function checkVisuals(page, selector) {
  const blocks = page.locator(selector)
  // 宽度切换会替换并排/统一 Diff，等当前布局节点完成挂载后再测量。
  await expect(async () => {
    const result = await blocks.evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node)
      const content = node.querySelector('.requirement-callout__content')
      const icon = node.querySelector('.requirement-callout__icon svg')
      const rect = content.getBoundingClientRect(), iconRect = icon.getBoundingClientRect()
      const ctx = document.createElement('canvas').getContext('2d')
      const rgb = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
      const luminance = color => rgb(color).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0)
      const a = luminance(style.color), b = luminance(style.backgroundColor)
      return { tone: node.dataset.tone, background: style.backgroundColor, border: style.borderLeftWidth, label: node.getAttribute('aria-label'),
        contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
        align: Math.abs(iconRect.y + iconRect.height / 2 - rect.y - parseFloat(getComputedStyle(content).lineHeight) / 2),
        overflow: node.scrollWidth - node.clientWidth }
    }))
    expect(new Set(result.map(r => r.background)).size, JSON.stringify(result)).toBe(4)
    for (const r of result) {
      expect(r.border).toBe('1px'); expect(labels).toContain(r.label)
      expect(r.contrast).toBeGreaterThanOrEqual(4.5)
      expect(r.align).toBeLessThan(1); expect(r.overflow).toBeLessThanOrEqual(1)
    }
  }).toPass({ timeout: 5000 })
}

export async function verifyEditorCallouts(page) {
  for (const collaborative of [false, true]) {
    await page.emulateMedia({ reducedMotion: collaborative ? 'reduce' : 'no-preference' })
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content: { type: 'doc', content: [p('start', '保留正文')] } })
    await select(page, 'start')
    await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
    await page.getByText('组件块', { exact: true }).hover()
    await page.getByText('注意', { exact: true }).click()
    await expect(page.getByRole('menu', { name: '更多格式工具', exact: true })).toBeHidden()
    const callout = page.locator('.tiptap .requirement-callout')
    await expect(callout).toHaveAttribute('data-tone', 'warning')
    await expect(callout.locator('.requirement-callout__content')).toHaveAttribute('data-placeholder', placeholders[2])
    await expect(callout).toHaveText('')
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('callout')
    await page.keyboard.insertText('输入内容')
    const before = await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), selection: window.editorFixture.editor().state.selection.toJSON() }))
    await callout.getByRole('button', { name: '注意：切换提示类型', exact: true }).click()
    expect(await page.evaluate(() => window.editorFixture.editor().state.selection.toJSON())).toEqual(before.selection)
    await page.getByRole('menu', { name: '切换提示类型', exact: true }).getByText('风险', { exact: true }).click()
    await expect(callout).toHaveAttribute('data-tone', 'danger')
    await page.keyboard.insertText('后续')
    await page.keyboard.press('Control+z'); await expect(callout).toHaveText('输入内容')
    await page.keyboard.press('Control+z'); await expect(callout).toHaveAttribute('data-tone', 'warning')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before.json)
    await page.keyboard.press('Control+Shift+z'); await expect(callout).toHaveAttribute('data-tone', 'danger')
    // 键盘菜单与右键共用相同的当前块目标。
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: '切换提示类型', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menuitemradio', { name: '说明 补充背景、统计口径、名词解释', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    await expect(callout).toHaveAttribute('data-tone', 'tip')
    await callout.locator('.requirement-callout__content').click({ button: 'right' })
    await page.getByText('切换提示类型', { exact: true }).hover()
    await page.getByText('说明', { exact: true }).click()
    await expect(callout).toHaveAttribute('data-tone', 'note')
    // 复制实际节点只携带正文和 tone，不携带图标、菜单或占位文案。
    await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'callout') editor.commands.setNodeSelection(pos) })
      editor.view.focus()
    })
    await page.keyboard.press('Control+c')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('输入内容')
    const html = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text())
    expect(html).toContain('data-tone="note"'); expect(html).not.toMatch(/<button|<svg|输入说明|切换提示类型/)
    await page.evaluate(() => window.editorFixture.editor().commands.focus('end'))
    await page.keyboard.press('Control+v')
    await expect(callout).toHaveCount(2)
    await expect(callout.last()).toHaveAttribute('data-tone', 'note')
    await expect(callout.last()).toHaveText('输入内容')
    const ids = await callout.evaluateAll(nodes => nodes.map(node => node.dataset.diffId))
    expect(new Set(ids).size).toBe(2)
    await page.keyboard.press('Control+z'); await expect(callout).toHaveCount(1)
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await expect(callout.locator('button')).toHaveCount(0)
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await expect(callout.locator('button')).toHaveCount(1)
  }
  await page.evaluate(content => window.editorFixture.mount(false, content), calloutDocument)
  const original = await page.evaluate(() => window.editorFixture.editor().getJSON())
  for (const value of ['light', 'dark']) {
    await theme(page, value)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      await checkVisuals(page, '.tiptap .requirement-callout')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await capture(page, `req-30-editor-${value}-${width}`)
    }
  }
  expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(original)
  await page.evaluate(content => window.editorFixture.mountRevision(content), calloutDocument)
  await expect(page.locator('.tiptap .requirement-callout button')).toHaveCount(0)
  await checkVisuals(page, '.tiptap .requirement-callout')
  await verifyCalloutSync(page)
  await theme(page, 'light')
  console.log('通过：提示块插入、图标/键盘/右键切换、光标、独立撤销、复制、只读、四种宽度/亮暗对比度与双页 Yjs 同步。')
}

export async function verifyCalloutSync(page) {
  // 两个真实 Yjs 文档交换二进制状态，语气同步但不吞并远端文字。
  await page.evaluate(content => window.editorFixture.mount(true, content), calloutDocument)
  const remote = await page.context().newPage()
  try {
    await remote.goto(page.url())
    await remote.waitForFunction(() => window.editorFixture)
    const state = await page.evaluate(() => window.editorFixture.collaborationState())
    await remote.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content: calloutDocument, state })
    await select(remote, 'note'); await remote.keyboard.insertText('远端内容')
    await page.locator('[data-diff-id="note"]').getByRole('button', { name: '说明：切换提示类型', exact: true }).click()
    await page.getByRole('menu', { name: '切换提示类型', exact: true }).getByText('风险', { exact: true }).click()
    await expect(page.locator('[data-diff-id="note"]')).toHaveAttribute('data-tone', 'danger')
    const [localState, remoteState] = await Promise.all([page.evaluate(() => window.editorFixture.collaborationState()), remote.evaluate(() => window.editorFixture.collaborationState())])
    await page.evaluate(state => window.editorFixture.receiveState(state), remoteState)
    await remote.evaluate(state => window.editorFixture.receiveState(state), localState)
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(await remote.evaluate(() => window.editorFixture.editor().getJSON()))
    await expect(page.locator('[data-diff-id="note"]')).toHaveAttribute('data-tone', 'danger')
    await expect(page.locator('[data-diff-id="note"]')).toContainText('远端内容')
  } finally { await remote.close() }
}

export async function verifyWorkspaceCallouts(page, url, screenshot) {
  await page.goto(url)
  await page.evaluate(content => {
    window.workspaceFixture.preferences.resetReading()
    const base = structuredClone(content); base.content[0].attrs.tone = 'warning'
    window.workspaceFixture.setComparison(base, content)
  }, calloutDocument)
  const note = page.locator('.tiptap [data-diff-id="note"]')
  await note.click({ button: 'right', position: { x: 4, y: 8 } })
  await page.getByText('标注提示块', { exact: true }).click()
  await page.getByRole('textbox', { name: '标注修改要求' }).fill('核实说明')
  await page.getByRole('button', { name: '保存标注', exact: true }).click()
  const original = await page.evaluate(() => window.workspaceFixture.document())
  async function switchTone() {
    await note.getByRole('button', { name: '说明：切换提示类型', exact: true }).click()
    await page.getByText('注意', { exact: true }).click()
  }
  await switchTone()
  const confirm = page.getByRole('dialog', { name: '修改标注原文', exact: true })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  expect(await page.evaluate(() => window.workspaceFixture.document())).toEqual(original)
  await switchTone(); await confirm.getByRole('button', { name: '确认', exact: true }).click()
  await expect(confirm).toBeHidden()
  await expect(note).toHaveAttribute('data-tone', 'warning')
  await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
  await select(page, 'note'); await page.keyboard.press('Control+z')
  await expect(note).toHaveAttribute('data-tone', 'note')
  const background = await note.evaluate(node => getComputedStyle(node).backgroundColor)
  await page.evaluate(() => {
    const prefs = window.workspaceFixture.preferences
    prefs.setFont('body', 'Arial'); prefs.setFontSize('paragraph', 20)
    prefs.setTextColor('paragraph', 'light', '#334455'); prefs.setLineHeight(2); prefs.setDocumentWidth(720)
  })
  await expect(note).toHaveCSS('font-size', '20px')
  await expect(note).toHaveCSS('line-height', '40px')
  await expect(note).toHaveCSS('color', 'rgb(51, 68, 85)')
  await expect(note).toHaveCSS('background-color', background)
  expect(await note.evaluate(node => getComputedStyle(node).fontFamily)).toContain('Arial')
  await page.evaluate(() => window.workspaceFixture.preferences.resetReading())
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.diff-block__tone-change').first()).toHaveText('语气：注意 → 说明')
  await expect(page.locator('.diff-block__callout button')).toHaveCount(0)
  await expect(page.getByLabel('Diff 统计').getByTitle('修改 1 处', { exact: true })).toBeVisible()
  await expect(page.locator('.diff-block__callout').first().locator('br')).toHaveCount(1)
  await expect(page.locator('.diff-block__callout .requirement-callout__content').first()).toHaveCSS('white-space', 'pre-wrap')
  for (const value of ['light', 'dark']) {
    await theme(page, value)
    for (const width of [320, 390, 960, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      await checkVisuals(page, '.diff-block__callout')
    }
    await screenshot(`req-30-diff-${value}`)
  }
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
  for (const [value, label] of [['light', '亮色配色'], ['dark', '暗色配色']]) {
    await settings.getByRole('combobox', { name: '编辑文字配色', exact: true }).click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await checkVisuals(page, '.app-settings-preview .requirement-callout')
  }
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  const token = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'tip'), calloutDocument)
  await page.goto(`${url}?selection=1&context=${token}`)
  await expect(page.locator('.selection-history-workspace .requirement-callout').first()).toBeVisible()
  await expect(page.locator('.selection-history-workspace .requirement-callout button')).toHaveCount(0)
  console.log('通过：提示块标注取消/确认、Diff 语气说明、只读比较、独立配色设置预览和选区历史。')
}
