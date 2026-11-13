import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (id, value) => ({ type: 'paragraph', attrs: { diffId: id }, ...(value ? { content: [text(value)] } : {}) })
const heading = (level, value) => ({ type: 'heading', attrs: { diffId: `visual-h${level}`, level }, content: [text(value)] })
const item = (id, value, nested = []) => ({ type: 'listItem', attrs: { diffId: id }, content: [p(`${id}-p`, value), ...nested] })
const imagePath = '/uploads/node-visuals.svg'

// 同一份稳定 ID 样本覆盖编辑、只读和 Diff，不依赖真实文档或数据库。
export const nodeVisualDocument = { type: 'doc', content: [
  heading(1, '正文节点 · 阅读与协作'),
  { ...p('visual-intro'), content: [text('统一文字节奏，让内容清晰可读。保留'), text('加粗', [{ type: 'bold' }]), text('、'), text('斜体', [{ type: 'italic' }]), text('与'), text('删除线', [{ type: 'strike' }]), text('。')] },
  { ...p('visual-marks'), content: [text('阅读'), text('使用说明', [{ type: 'link', attrs: { href: 'https://example.com/guide' } }]), text('，关注'), text('需要确认的重点', [{ type: 'highlight' }]), text('；行内代码 '), text('document.diffId', [{ type: 'code' }]), text(' 保持原有行高。')] },
  heading(2, '清晰的内容层次'),
  p('visual-body', '标题与下一段保持紧密联系，长段落自然换行。浅色与暗色主题使用相同的结构和间距。'),
  { type: 'bulletList', attrs: { diffId: 'visual-bullets' }, content: [
    item('visual-item-1', '列表项保持紧凑，适合阅读连续要点。', [{ type: 'orderedList', attrs: { diffId: 'visual-nested', start: 1 }, content: [item('visual-nested-1', '嵌套列表保留层级与四像素间距。'), item('visual-nested-2', '编号和项目符号共用缩进。')] }]),
    item('visual-item-2', '多行内容仍与首行对齐，不插入额外段落空白。'),
  ] },
  { type: 'orderedList', attrs: { diffId: 'visual-numbers', start: 9 }, content: [item('visual-number-9', '检查两位编号的右对齐。'), item('visual-number-10', '确认编号宽度不会改变正文起点。')] },
  heading(3, '引用、提示与代码'),
  { type: 'blockquote', attrs: { diffId: 'visual-quote' }, content: [p('visual-quote-p', '引用是别人的话，使用中性竖线和辅助文字色，与提示和代码区分。')] },
  { type: 'callout', attrs: { diffId: 'visual-callout', tone: 'note' }, content: [text('提示：当前继续保留原有提示块，四种语气将在后续需求中实现。')] },
  { type: 'codeBlock', attrs: { diffId: 'visual-code', language: 'typescript' }, content: [text('const document = {\n  title: "正文节点视觉统一",\n  changes: ["新增", "修改", "删除"],\n}\nconst longLine = "横向滚动限制在代码块内部，不扩张整篇文档。"')] },
  { type: 'horizontalRule', attrs: { diffId: 'visual-rule' } },
  { type: 'table', attrs: { diffId: 'visual-table' }, content: [
    { type: 'tableRow', content: ['节点', '视觉语义'].map((value, i) => ({ type: 'tableHeader', content: [p(`visual-th-${i}`, value)] })) },
    { type: 'tableRow', content: ['修改', '琥珀黄色；新增绿色；删除鲜红色'].map((value, i) => ({ type: 'tableCell', content: [p(`visual-td-${i}`, value)] })) },
  ] },
  { type: 'image', attrs: { diffId: 'visual-image', src: imagePath, alt: '透明背景的流程示意', align: 'left', width: 480, height: 160 }, content: [{ type: 'imageCaption', content: [text('图片保持原尺寸与题注布局，选中时显示强调色描边。')] }] },
  p('visual-empty'),
  p('visual-end', '空段落保留排版空间，提示在编辑和只读状态下常驻显示。'),
] }

async function routeImage(page) {
  await page.route(`**${imagePath}`, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160"><rect x="12" y="38" width="120" height="70" rx="8" fill="#315fc4"/><rect x="180" y="38" width="120" height="70" rx="8" fill="#56616f"/><rect x="348" y="38" width="120" height="70" rx="8" fill="#b45309"/><path d="M138 73h36m132 0h36" stroke="#8995a4" stroke-width="3"/><g fill="white" font-size="18" text-anchor="middle"><text x="72" y="80">编辑</text><text x="240" y="80">比较</text><text x="408" y="80">确认</text></g></svg>' }))
}

async function setTheme(page, theme) {
  await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
  await page.emulateMedia({ colorScheme: theme })
}

const colors = {
  light: { accent: 'rgb(49, 95, 196)', divider: 'rgb(216, 221, 227)', quote: 'rgb(86, 97, 111)', region: 'rgb(244, 245, 246)', mark: 'rgb(255, 241, 184)', ink: 'rgb(32, 36, 42)' },
  dark: { accent: 'rgb(162, 190, 255)', divider: 'rgb(65, 75, 88)', quote: 'rgb(186, 196, 209)', region: 'rgb(34, 40, 48)', mark: 'rgb(70, 56, 11)', ink: 'rgb(255, 233, 160)' },
}

async function verifyBody(page, theme, root = '.tiptap') {
  const body = page.locator(root)
  const color = colors[theme]
  await expect(body.locator('h1').first()).toHaveCSS('font-size', '24px')
  await expect(body.locator('h2').first()).toHaveCSS('margin-top', '32px')
  await expect(body.locator('h3').first()).toHaveCSS('font-weight', '600')
  await expect(body.locator('li p').first()).toHaveCSS('margin-bottom', '0px')
  await expect(body.locator('li + li').first()).toHaveCSS('margin-top', '4px')
  await expect(body.locator('blockquote')).toHaveCSS('border-left', `3px solid ${color.divider}`)
  await expect(body.locator('blockquote')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(body.locator('blockquote p')).toHaveCSS('color', color.quote)
  await expect(body.locator('.requirement-code-block')).toHaveCSS('border-left', `1px solid ${color.divider}`)
  await expect(body.locator('pre')).toHaveCSS('border-left-width', '0px')
  await expect(body.locator('pre')).toHaveCSS('padding', '14px 16px')
  await expect(body.locator('pre')).toHaveCSS('line-height', '24.816px')
  await expect(body.locator('hr')).toHaveCSS('height', '1px')
  await expect(body.locator('hr')).toHaveCSS('background-color', color.divider)
  await expect(body.locator('th').first()).toHaveCSS('background-color', color.region)
  await expect(body.locator('mark')).toHaveCSS('background-color', color.mark)
  await expect(body.locator('mark')).toHaveCSS('color', color.ink)
  await expect(body.locator('a')).toHaveCSS('color', color.accent)
  await expect(body.locator('a')).toHaveCSS('font-weight', '400')
  await expect(body.locator('a')).toHaveCSS('text-decoration-thickness', '1px')
}

async function screenshot(page, name) {
  if (!process.env.BROWSER_TEST_ARTIFACT_DIR) return
  await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
  await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `${name}.png`), fullPage: true })
}

export async function verifyEditorNodeVisuals(page) {
  const viewport = page.viewportSize()
  await routeImage(page)
  for (const collaborative of [false, true]) {
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content: nodeVisualDocument })
    const original = await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, local: window.editorFixture.localUpdates }))
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme)
      await verifyBody(page, theme)
      const empty = page.locator('[data-diff-id="visual-empty"]')
      const opacity = () => empty.evaluate(element => getComputedStyle(element, '::before').opacity)
      await page.mouse.move(0, 0)
      await page.evaluate(() => window.editorFixture.editor().commands.blur())
      expect(await opacity()).toBe('1')
      expect(await empty.evaluate(element => getComputedStyle(element, '::before').visibility)).toBe('visible')
      await empty.hover()
      expect(await opacity()).toBe('1')
      await empty.click()
      await page.mouse.move(0, 0)
      expect(await opacity()).toBe('1')
      await page.evaluate(() => {
        const editor = window.editorFixture.editor()
        const pos = editor.state.selection.from
        editor.commands.setTextSelection({ from: pos, to: pos + 2 })
      })
      expect(await opacity()).toBe('1')
      await page.evaluate(() => window.editorFixture.setDisabled(true))
      await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'false')
      await empty.hover()
      expect(await opacity()).toBe('1')
      await page.evaluate(() => window.editorFixture.setDisabled(false))
      await expect(page.locator('.tiptap')).toHaveAttribute('contenteditable', 'true')

      const image = page.locator('.requirement-image')
      const surface = image.locator('.bing-resizable__surface')
      await expect.poll(() => image.locator('img').evaluate(node => node.complete && node.naturalWidth)).toBe(480)
      await page.mouse.move(0, 0)
      await expect(surface).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
      await image.scrollIntoViewIfNeeded()
      const before = await image.boundingBox()
      await image.locator('img').hover()
      await expect(surface).toHaveCSS('outline', `${colors[theme].divider} solid 1px`)
      await page.evaluate(() => {
        const editor = window.editorFixture.editor()
        editor.state.doc.descendants((node, pos) => { if (node.attrs.diffId === 'visual-image') editor.commands.setNodeSelection(pos) })
      })
      await expect(surface).toHaveCSS('outline', `${colors[theme].accent} solid 2px`)
      expect(await image.boundingBox()).toEqual(before)
      await page.evaluate(() => window.editorFixture.editor().commands.setTextSelection(1))
      await page.keyboard.press('Tab')
      await image.getByRole('button', { name: '预览图片', exact: true }).focus()
      await expect(surface).toHaveCSS('outline', `${colors[theme].accent} solid 2px`)
      expect(await image.boundingBox()).toEqual(before)
      await page.evaluate(() => { window.editorFixture.editor().commands.blur(); document.activeElement?.blur() })
      if (!collaborative) for (const width of [320, 390, 960, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.mouse.move(0, 0)
        await expect.poll(() => image.locator('img').evaluate(node => node.getBoundingClientRect().right - node.closest('.tiptap').getBoundingClientRect().right)).toBeLessThanOrEqual(0)
        const height = await page.locator('.tiptap').evaluate(node => Math.ceil(node.scrollHeight) + 160)
        await page.setViewportSize({ width, height })
        await page.locator('.requirement-editor__scroll > .bing-scrollbar__viewport').evaluate(node => node.scrollTo(0, 0))
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        await screenshot(page, `req-28-editor-${theme}-${width}`)
      }
    }
    expect(await page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(), updates: window.editorFixture.modelUpdates, local: window.editorFixture.localUpdates }))).toEqual(original)
    // 纯视图交互不能挤占普通历史或协作者个人撤销。
    // 真实点击完成聚焦，避免前面的异步 blur 清除输入光标。
    const title = page.locator('[data-diff-id="visual-h1"]')
    await title.click()
    await page.keyboard.press('Home')
    await page.keyboard.insertText('输入')
    await expect(title).toHaveText('输入正文节点 · 阅读与协作')
    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(original.json)
  }
  await page.evaluate(content => window.editorFixture.mountRevision(content), nodeVisualDocument)
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await verifyBody(page, theme)
    const empty = page.locator('[data-diff-id="visual-empty"]')
    await page.mouse.move(0, 0)
    expect(await empty.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1')
    expect(await empty.evaluate(element => getComputedStyle(element, '::before').visibility)).toBe('visible')
    await empty.hover()
    expect(await empty.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1')
    await expect(page.locator('.requirement-image .bing-resizable__surface')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  }
  await setTheme(page, 'light')
  await page.setViewportSize(viewport)
  console.log('通过：全节点亮暗主题、四种宽度截图、空段落提示、图片悬停/选中/键盘焦点、历史只读、普通/Yjs 数据与撤销不变。')
}

export async function verifyWorkspaceNodeVisuals(page, url, capture) {
  await page.goto(url)
  await routeImage(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(content => {
    window.workspaceFixture.preferences.resetReading()
    window.workspaceFixture.setComparison(content, content)
  }, nodeVisualDocument)
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await expect(page.locator('.diff-block mark').first()).toBeAttached()
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await expect(page.locator('.diff-block mark').first()).toHaveCSS('background-color', colors[theme].mark)
    await expect(page.locator('.diff-block mark').first()).toHaveCSS('color', colors[theme].ink)
    await expect(page.locator('.diff-inline-mark--link').first()).toHaveCSS('color', colors[theme].accent)
    await expect(page.locator('.diff-block blockquote').first()).toHaveCSS('border-left', `3px solid ${colors[theme].divider}`)
    await expect(page.locator('.diff-block .requirement-code-block').first()).toHaveCSS('border-left', `1px solid ${colors[theme].divider}`)
    await expect(page.locator('.diff-block pre').first()).toHaveCSS('line-height', '24.816px')
    const headings = await page.locator('.diff-block h1').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top))
    expect(headings[0]).toBe(headings[1])
    await expect(page.locator('.diff-block__empty-paragraph').first()).toContainText('空段落')
    await expect(page.locator('.diff-block__image img').first()).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await capture(`req-28-diff-${theme}`)
  }
  await setTheme(page, 'light')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.getByRole('tab', { name: '阅读与编辑', exact: true }).click()
  for (const [theme, label] of [['dark', '暗色配色'], ['light', '亮色配色']]) {
    await dialog.getByRole('combobox', { name: '编辑文字配色', exact: true }).click()
    await page.getByRole('option', { name: label, exact: true }).click()
    await expect(page.locator('.app-settings-preview h1')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.app-settings-preview mark')).toHaveCSS('background-color', colors[theme].mark)
    await expect(page.locator('.app-settings-preview mark')).toHaveCSS('color', colors[theme].ink)
    await expect(page.locator('.app-settings-preview a')).toHaveCSS('color', colors[theme].accent)
  }
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  const token = await page.evaluate(content => window.workspaceFixture.createSelectionContext(content, 'visual-marks'), nodeVisualDocument)
  await page.goto(`${url}?selection=1&context=${token}`)
  await expect(page.locator('.selection-history-workspace')).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme)
    await expect(page.locator('.selection-history-workspace mark').first()).toHaveCSS('background-color', colors[theme].mark)
    await expect(page.locator('.selection-history-workspace mark').first()).toHaveCSS('color', colors[theme].ink)
    await expect(page.locator('.selection-history-workspace .diff-inline-mark--link').first()).toHaveCSS('color', colors[theme].accent)
  }
  console.log('通过：真实版本比较、选区历史和设置预览共用正文节点主题，预览配色独立于应用主题。')
}
