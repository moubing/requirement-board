import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const p = (id, text) => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
const chapterDocument = { type: 'doc', content: [1, 2, 3].flatMap(level => [
  { type: 'heading', attrs: { diffId: `chapter-${level}`, level }, content: [{ type: 'text', text: `${level} 章节链接测试标题` }] },
  p(`text-${level}`, '正文内容与标题保持独立。'),
]) }
const snapshot = page => page.evaluate(() => {
  const f = window.editorFixture
  return { json: f.editor().getJSON(), updates: f.modelUpdates, local: f.localUpdates, selection: f.editor().state.selection.toJSON() }
})

async function verifyChapterRedraw(page, url) {
  const heading = (id, level) => ({ type: 'heading', attrs: { diffId: id, level }, content: [{ type: 'text', text: `${id} 章节标题` }] })
  const content = { type: 'doc', content: [
    p('intro', '正文重绘不应改变章节位置。'), heading('redraw-upper', 3),
    ...Array.from({ length: 18 }, (_, i) => p(`before-${i}`, `第 ${i + 1} 段正文`)),
    { type: 'codeBlock', attrs: { diffId: 'redraw-code', language: 'html' }, content: [{ type: 'text', text: '<div>示例</div>' }] },
    heading('redraw-lower', 2),
    { type: 'orderedList', attrs: { diffId: 'redraw-list' }, content: Array.from({ length: 5 }, (_, i) => ({ type: 'listItem', attrs: { diffId: `item-${i}` }, content: [p(`item-text-${i}`, `列表项 ${i + 1}`)] })) },
    { type: 'table', attrs: { diffId: 'redraw-table' }, content: [{ type: 'tableRow', content: [0, 1].map(i => ({ type: 'tableCell', attrs: { diffId: `cell-${i}` }, content: [p(`cell-text-${i}`, '表格正文')] })) }] },
    ...Array.from({ length: 18 }, (_, i) => p(`after-${i}`, `后续正文 ${i + 1}`)),
  ] }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(url)
  await expect(page.locator('.tiptap')).toBeVisible()
  await page.evaluate(content => window.workspaceFixture.setComparison(content, structuredClone(content)), content)
  await expect(page.locator('.tiptap h2')).toHaveText('redraw-lower 章节标题')
  const before = await page.locator('.tiptap').evaluate(el => ({ json: el.editor.getJSON(), selection: el.editor.state.selection.toJSON() }))
  for (const motion of ['no-preference', 'reduce']) for (const id of ['redraw-lower', 'redraw-upper']) {
    await page.emulateMedia({ reducedMotion: motion })
    // 模拟浏览器扩展在首屏/滚动时追加辅助属性，触发真实 ProseMirror DOM 重绘。
    const replaced = await page.evaluate(async ({ id, motion }) => {
      const root = document.querySelector('.tiptap'), viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
      const target = root.querySelector(`[data-diff-id="${id}"]`), top = viewport.scrollTop
      window.workspaceFixture.route.query = { block: id }
      const deadline = performance.now() + 3000
      while (performance.now() < deadline && (motion === 'reduce' ? !document.querySelector('.chapter-links__emphasis') : Math.abs(viewport.scrollTop - top) < 100)) await new Promise(resolve => requestAnimationFrame(resolve))
      for (const node of root.querySelectorAll('p, ol, li')) node.setAttribute('data-extension-scrollable', id)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return !target.isConnected
    }, { id, motion })
    expect(replaced, '辅助属性确实触发了标题 DOM 重建').toBe(true)
    const delta = () => page.evaluate(id => {
      const viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
      return document.querySelector(`[data-diff-id="${id}"]`).getBoundingClientRect().top - viewport.getBoundingClientRect().top
    }, id)
    await expect.poll(delta, { message: `${motion} 重绘后 ${id} 仍完成定位` }).toBeCloseTo(28, 0)
    await expect(page.locator('.chapter-links__emphasis')).toBeVisible()
    // 到达后再次重绘，闪动区域跟随同一 diffId 的新节点，位置不回跳。
    await page.evaluate(() => {
      for (const node of document.querySelectorAll('.tiptap p, .tiptap ol, .tiptap li')) node.removeAttribute('data-extension-scrollable')
    })
    await expect(page.locator('.chapter-links__emphasis')).toBeVisible()
    expect(await delta()).toBeCloseTo(28, 0)
    await expect(page.locator('.chapter-links__emphasis')).toHaveCount(0)
    expect(await delta()).toBeCloseTo(28, 0)
    expect(await page.locator('.tiptap').evaluate(el => ({ json: el.editor.getJSON(), selection: el.editor.state.selection.toJSON() }))).toEqual(before)
  }
}

export async function verifyEditorChapterLinks(page) {
  for (const collaborative of [false, true]) {
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content, { requirementId: 'chapter-doc' }), { collaborative, content: chapterDocument })
    await page.locator('.tiptap h2').click()
    await page.mouse.move(0, 0)
    const button = page.locator('.chapter-links__copy')
    await expect(button).toHaveAttribute('data-chapter-id', 'chapter-2')
    const before = await snapshot(page)
    await button.click()
    const url = new URL(await page.evaluate(() => navigator.clipboard.readText()))
    expect(url.pathname).toBe('/requirements/chapter-doc')
    expect(url.search).toBe('?block=chapter-2')
    await expect(page.getByText('章节链接已复制', { exact: true })).toBeVisible()
    expect(await snapshot(page)).toEqual(before)
    await page.locator('.tiptap h2').click()
    await page.mouse.move(0, 0)
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    await page.keyboard.press('Enter')
    expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=chapter-2')
    expect(await snapshot(page)).toEqual(before)

    // 键盘入口与鼠标右键都冻结标题目标，弹层不污染正文和协作历史。
    await page.locator('.tiptap').focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: '复制章节链接', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: '复制章节链接', exact: true }).click()
    expect(await snapshot(page)).toEqual(before)
    await page.locator('.tiptap h1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '复制章节链接', exact: true }).click()
    expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=chapter-1')
    await page.locator('.tiptap p').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '复制章节链接', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.locator('.tiptap h3').evaluate(heading => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection(editor.view.posAtDOM(heading, 0))
      editor.view.dom.focus({ preventScroll: true })
    })
    await page.keyboard.press('ContextMenu')
    await expect(page.getByRole('menuitem', { name: '复制章节链接', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.evaluate(() => window.editorFixture.setDisabled(true))
    for (const width of [320, 390, 960, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
      const heading = page.locator('.tiptap h2')
      const beforeBox = await heading.boundingBox()
      await heading.hover()
      await expect(button).toHaveAttribute('data-chapter-id', 'chapter-2')
      expect(await heading.boundingBox()).toEqual(beforeBox)
      const box = await button.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR && !collaborative) {
        await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `chapter-${width}-${theme}.png`) })
      }
      await button.click()
      expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=chapter-2')
    }
    expect((await snapshot(page)).json).toEqual(before.json)
    expect((await snapshot(page)).local).toBe(before.local)
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await page.locator('.tiptap h2').click()
    await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.press('Control+c')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('2 章节链接测试标题')
  }
  await page.evaluate(content => window.editorFixture.mountRevision(content, 'chapter-doc'), chapterDocument)
  await page.locator('.tiptap h3').hover()
  await page.locator('.chapter-links__copy').focus()
  await page.mouse.move(0, 0)
  await page.keyboard.press('Enter')
  expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=chapter-3')
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException('denied', 'NotAllowedError') } })
  await page.locator('.chapter-links__copy').click()
  await expect(page.getByText('复制失败，请检查剪贴板权限后重试', { exact: true })).toBeVisible()
  console.log('REQ-32 编辑器：三级标题、鼠标/键盘、只读、协作无写入、正文复制、主题与四档宽度通过。')
}

export async function verifyWorkspaceChapterLinks(page, url, screenshot) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await verifyChapterRedraw(page, url)
  const body = page.getByRole('region', { name: '文档正文', exact: true })
  const offset = id => page.evaluate(id => {
    const viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
    const heading = document.querySelector(`.tiptap [data-diff-id="${id}"]`)
    return { delta: heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top, top: viewport.scrollTop,
      outer: document.querySelector('[aria-label="页面内容"][role="region"]')?.scrollTop ?? 0, window: scrollY }
  }, id)
  // 首次定位途中侧栏/字体完成排版：旧阅读锚点不能终止动画，目标坐标须随新布局更新。
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(url)
  await expect(page.locator('.tiptap')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => {
    const viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
    const changeLayout = () => {
      if (viewport.scrollTop < 30) { requestAnimationFrame(changeLayout); return }
      viewport.style.width = '70%'
      document.documentElement.style.setProperty('--rb-editor-font-body', 'Arial, sans-serif')
    }
    window.workspaceFixture.route.query = { block: 'heading_5' }
    requestAnimationFrame(changeLayout)
  })
  await expect.poll(async () => (await offset('heading_5')).delta, { message: '布局变化后仍到达标题', timeout: 4000 }).toBeCloseTo(28, 0)
  await expect(page.locator('.chapter-links__emphasis')).toBeVisible()
  await expect(page.locator('.chapter-links__emphasis')).toHaveCount(0)
  expect((await offset('heading_5')).delta).toBeCloseTo(28, 0)
  // 用户已经开始操作时，布局跟踪也必须立即让出控制，不能继续把人拉回目标。
  const stopped = await page.evaluate(async () => {
    const viewport = document.querySelector('[aria-label="文档正文"][role="region"]')
    const before = viewport.scrollTop
    window.workspaceFixture.route.query = { block: 'heading_2' }
    while (Math.abs(viewport.scrollTop - before) < 30) await new Promise(resolve => requestAnimationFrame(resolve))
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }))
    return viewport.scrollTop
  })
  await page.waitForTimeout(800)
  expect(await body.evaluate(el => el.scrollTop)).toBe(stopped)
  await expect(page.locator('.chapter-links__emphasis')).toHaveCount(0)
  for (const motion of ['reduce', 'no-preference']) {
    await page.emulateMedia({ reducedMotion: motion })
    await page.goto(`${url}?block=heading_5&view=diff`)
    await expect(page.locator('.tiptap')).toBeVisible()
    await expect.poll(async () => (await offset('heading_5')).delta).toBeCloseTo(28, 0)
    expect((await offset('heading_5')).outer).toBe(0)
    expect((await offset('heading_5')).window).toBe(0)
    await expect(page.locator('.chapter-links__emphasis')).toBeVisible()
    if (motion === 'reduce') expect(await page.locator('.chapter-links__emphasis').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
    await expect(page.locator('.chapter-links__emphasis')).toHaveCount(0)
    // 同实例新的 block；无重新挂载和正文修改。
    const snapshot = await page.locator('.tiptap').evaluate(el => ({ json: el.editor.getJSON(), selection: el.editor.state.selection.toJSON() }))
    await page.evaluate(() => { window.workspaceFixture.route.query = { block: 'heading_2' } })
    await expect.poll(async () => (await offset('heading_2')).delta).toBeCloseTo(28, 0)
    expect(await page.locator('.tiptap').evaluate(el => ({ json: el.editor.getJSON(), selection: el.editor.state.selection.toJSON() }))).toEqual(snapshot)
  }
  for (const block of ['deleted', 'paragraph_0_0', '"]bad', '']) {
    await page.goto(`${url}?block=${encodeURIComponent(block)}&view=diff&keep=1`)
    await expect(page.getByText('该章节已不存在', { exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.has('block')).toBe(false)
    expect(new URL(page.url()).searchParams.get('keep')).toBe('1')
    expect(await body.evaluate(el => el.scrollTop)).toBe(0)
  }
  await page.goto(url)
  await page.locator('.tiptap h1').hover()
  await page.locator('.chapter-links__copy').click()
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()))
  expect(copied.pathname).toBe('/requirements/fixture')
  const tabContext = await page.context().browser().newContext({ reducedMotion: 'reduce' })
  const tab = await tabContext.newPage()
  try {
    // 复用数据夹具加载新页面；链接参数、详情页、编辑器和滚动路径均使用真实实现。
    await tab.goto(`${url}${copied.search}`)
    await expect(tab.locator('.chapter-links__emphasis')).toBeVisible()
  } finally { await tabContext.close() }
  await screenshot('chapter-workspace')
  await page.getByRole('tab', { name: '版本比较', exact: true }).click()
  await page.locator('.rich-diff h1').last().hover()
  await expect(page.locator('.rich-diff .chapter-links__copy')).toBeVisible()
  await page.locator('.rich-diff .chapter-links__copy').click()
  expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=heading_0')
  await page.getByRole('tab', { name: '正文', exact: true }).click()
  const beforeInterrupt = await body.evaluate(el => el.scrollTop)
  await page.evaluate(() => {
    window.workspaceFixture.route.query = { block: 'heading_8' }
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }))
  })
  await page.waitForTimeout(250)
  expect(await body.evaluate(el => el.scrollTop)).toBe(beforeInterrupt)

  // 同一标题同时出现版本竖条、AI 编号与 #，三者不能遮挡或改写标题换行。
  await page.evaluate(() => {
    const base = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1, diffId: 'heading_0' }, content: [{ type: 'text', text: '原始标题' }] },
      { type: 'paragraph', attrs: { diffId: 'tail' }, content: [{ type: 'text', text: '正文保留原有颜色和行高。' }] }] }
    const target = structuredClone(base)
    target.content[0].content[0].text = '章节链接与版本标记以及 AI 标注同时出现时保持各自的位置，较长的标题仍按原有宽度自然换行'
    window.workspaceFixture.setComparison(base, target)
  })
  await expect(page.locator('.tiptap h1')).toContainText('章节链接与版本标记')
  await page.locator('.tiptap h1').evaluate(heading => {
    heading.closest('.tiptap').focus({ preventScroll: true })
    const range = document.createRange(); range.setStart(heading.firstChild, 0); range.setEnd(heading.firstChild, 36)
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await page.locator('.requirement-editor__selection-menu').getByRole('button', { name: '添加 AI 标注', exact: true }).click()
  const composer = page.getByRole('dialog', { name: '添加 AI 标注', exact: true })
  await composer.getByRole('textbox', { name: '标注修改要求' }).fill('检查标题与章节链接的布局')
  await composer.getByRole('button', { name: '保存标注', exact: true }).click()
  await expect(composer).toBeHidden()
  await page.evaluate(() => document.querySelector('.tiptap').editor.commands.setTextSelection(1))
  for (const width of [320, 390, 960, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
    const heading = page.locator('.tiptap h1')
    await heading.scrollIntoViewIfNeeded()
    await heading.hover()
    await expect(page.locator('.chapter-links__copy')).toBeVisible()
    await expect(page.locator('.annotation-overlay__pin-anchor')).toHaveCount(1)
    const rects = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON()
      return { copy: rect('.chapter-links__copy'), pin: rect('.annotation-overlay__pin-anchor'), marker: rect('.version-markers__hit') }
    })
    for (const other of [rects.pin, rects.marker]) {
      expect(other).toBeTruthy()
      expect(rects.copy.right <= other.left || rects.copy.left >= other.right || rects.copy.bottom <= other.top || rects.copy.top >= other.bottom).toBe(true)
    }
    if (width > 700) expect(rects.copy.right).toBeLessThanOrEqual(rects.marker.left)
    await screenshot(`chapter-gutter-${width}-${theme}`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const token = await page.evaluate(() => window.workspaceFixture.createSelectionContext(window.workspaceFixture.document(), 'heading_0'))
  await page.goto(`${url}?selection=1&context=${token}`)
  const historicalHeading = page.locator('.selection-history-workspace h1').last()
  await historicalHeading.hover()
  await page.locator('.selection-history-workspace .chapter-links__copy').click()
  expect(new URL(await page.evaluate(() => navigator.clipboard.readText())).search).toBe('?block=heading_0')
  console.log('REQ-32 工作区：新页面定位、view=diff 优先级、新 block、失效 ID 清理、平滑/减少动效、Diff 复制通过。')
}
