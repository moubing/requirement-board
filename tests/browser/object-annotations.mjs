import { expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAnnotationRequest, resolveAnnotationRequest } from '../../skills/requirement-board/scripts/annotations.mjs'

export async function verifyObjectAnnotations(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  await page.route('**/uploads/object-fixture.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64') }))
  try {
    await page.goto(url)
    await expect(page.locator('.tiptap')).toBeVisible()
    await page.evaluate(async () => {
      const { ensureBlockIds } = await import('/shared/editor/document.ts')
      const p = (id, text = '') => ({ type: 'paragraph', attrs: { diffId: id }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
      const image = id => ({ type: 'image', attrs: { diffId: id, src: '/uploads/object-fixture.png', width: 180, height: 120, alt: '相同图片', align: 'left' }, content: [{ type: 'imageCaption', content: [{ type: 'text', text: '图片题注' }] }] })
      const doc = ensureBlockIds({ type: 'doc', content: [p('text', '普通文字标注测试。'), image('image-a'), { type: 'table', attrs: { diffId: 'table' }, content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { diffId: 'merged', colspan: 2, rowspan: 2, colwidth: [380, 380] }, content: [p('header', '合并表头')] },
          { type: 'tableCell', attrs: { diffId: 'nested', colwidth: [380] }, content: [p('cell-text', '相同文字'), image('image-b')] },
        ] },
        { type: 'tableRow', content: [{ type: 'tableCell', attrs: { diffId: 'empty', colwidth: [380] }, content: [p('empty-p')] }] },
      ] }, p('end')] })
      window.workspaceFixture.setComparison(doc, doc)
    })
    const image = id => page.locator(`[data-image-diff-id="${id}"] .requirement-image__preview-trigger`)
    const cell = id => page.locator(`.tiptap [data-diff-id="${id}"]`)
    await expect(image('image-a')).toBeVisible()
    const original = await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))
    async function add(label, comment) {
      await page.getByText(label, { exact: true }).click()
      const composer = page.getByRole('dialog', { name: '添加 AI 标注', exact: true })
      await expect(composer).toBeVisible()
      await expect(composer.getByRole('textbox', { name: '标注修改要求' })).toBeFocused()
      await composer.getByRole('textbox', { name: '标注修改要求' }).fill(comment)
      await composer.getByRole('button', { name: '保存标注', exact: true }).click()
      await expect(composer).toBeHidden()
    }
    async function select(id, end) {
      await cell(id).evaluate((element, end) => {
        element.closest('.tiptap').focus({ preventScroll: true })
        const range = document.createRange(); range.setStart(element.firstChild ?? element, 0); range.setEnd(element.firstChild ?? element, end)
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
        document.dispatchEvent(new Event('selectionchange'))
      }, end)
    }
    // 鼠标命中的图片优先于残留文本选区，同源图片身份各自独立。
    await select('text', 4)
    await image('image-a').click({ button: 'right' })
    await expect(page.getByText('标注图片', { exact: true })).toBeVisible()
    await expect(page.getByText('标注整张表格', { exact: true })).toHaveCount(0)
    await add('标注图片', '修改第一张图片的题注')
    await image('image-b').click({ button: 'right' })
    for (const label of ['标注图片', '标注所在单元格', '标注整张表格']) await expect(page.getByText(label, { exact: true })).toBeVisible()
    await add('标注图片', '修改表内图片')
    await cell('empty').click({ button: 'right' })
    await expect(page.getByText('第 2 行 · 第 3 列', { exact: true })).toBeVisible()
    await add('标注当前单元格', '补充空单元格')
    await cell('merged').click({ button: 'right', position: { x: 20, y: 20 } })
    await expect(page.getByText('第 1–2 行 · 第 1–2 列', { exact: true })).toBeVisible()
    await add('标注整张表格', '检查全表')
    await select('text', 4)
    await page.locator('.requirement-editor__selection-menu').getByRole('button', { name: '添加 AI 标注', exact: true }).click()
    await page.getByRole('textbox', { name: '标注修改要求' }).fill('补充文字')
    await page.getByRole('button', { name: '保存标注', exact: true }).click()
    await expect(page.locator('.ai-annotations__card')).toHaveCount(5)
    await expect(page.locator('.ai-annotations__thumbnail')).toHaveCount(2)
    expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)
    await expect(page.locator('.tiptap .annotation-overlay')).toHaveCount(0)

    // 混合协议仅携带摘要和身份；定位器把同表操作归到一个顶层块。
    await page.getByRole('button', { name: '复制给 AI', exact: true }).click()
    await expect(page.getByText('AI 标注已复制', { exact: true })).toBeVisible()
    const copied = parseAnnotationRequest(await page.evaluate(() => navigator.clipboard.readText()))
    expect(copied.format).toBe('rb-annotations/v2')
    expect(copied.annotations.map(note => note.target.type)).toEqual(['node', 'node', 'node', 'node', 'text'])
    expect(copied.annotations.slice(0, 4).map(note => note.target.nodeType)).toEqual(['image', 'image', 'tableCell', 'table'])
    const contentJson = JSON.parse(original)
    const resolved = resolveAnnotationRequest(copied, { id: 'fixture', schemaVersion: 3, contentToken: copied.contentToken, contentJson }, copied.document.origin)
    expect(resolved.ready).toBe(true)
    expect(resolved.topLevelIds).toEqual(['image-a', 'table', 'text'])

    // 定位空格需先水平揭示目标；边框被表格滚动容器裁剪。
    await page.locator('.requirement-node-scroll__viewport').evaluate(element => { element.scrollLeft = 0 })
    await page.getByRole('button', { name: '定位标注 3', exact: true }).click()
    await expect.poll(() => page.locator('.requirement-node-scroll__viewport').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await expect(page.locator('.annotation-overlay__highlight.is-object').first()).toBeVisible()

    // 单格折叠光标与图片 NodeSelection 的键盘菜单；多格选区不借用上次对象。
    await select('empty-p', 0)
    await page.keyboard.press('Shift+F10')
    await expect(page.getByText('标注当前单元格', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.tiptap').evaluate(element => {
      const editor = element.editor; let pos
      editor.state.doc.descendants((node, position) => { if (node.attrs.diffId === 'image-a') pos = position })
      editor.commands.setNodeSelection(pos); editor.view.dom.focus({ preventScroll: true })
    })
    await page.keyboard.press('ContextMenu')
    await expect(page.getByText('标注图片', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('.tiptap').evaluate(element => {
      const editor = element.editor, cells = []
      editor.state.doc.descendants((node, pos) => { if (['tableCell', 'tableHeader'].includes(node.type.name)) cells.push(pos) })
      editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] }); editor.view.dom.focus({ preventScroll: true })
    })
    await page.keyboard.press('Shift+F10')
    await expect(page.getByText('标注当前单元格', { exact: true })).toHaveCount(0)
    await expect(page.getByText('标注图片', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await select('cell-text', 2)
    await expect(page.locator('.requirement-editor__selection-menu').getByRole('button', { name: '添加 AI 标注', exact: true })).toHaveCount(0)

    // 编辑一处同时影响图片与整表，取消不修改正文，确认只删除受影响标注。
    await select('cell-text', 2)
    await page.keyboard.insertText('新')
    const confirm = page.getByRole('dialog', { name: '修改标注原文', exact: true })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(5)

    // 触屏空白长按 500ms；移动、滚动与第二指取消；文字长按保留原生行为。
    const touch = async (kind, x, y, id = 1) => page.dispatchEvent('.tiptap [data-diff-id="empty"]', kind, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true })
    await cell('empty').scrollIntoViewIfNeeded()
    const box = await cell('empty').boundingBox(), x = box.x + 5, y = box.y + box.height - 5
    for (const cancel of [() => touch('pointermove', x + 9, y), () => touch('pointerdown', x, y, 2), () => page.locator('.requirement-node-scroll__viewport').dispatchEvent('scroll')]) {
      await touch('pointerdown', x, y); await cancel(); await page.waitForTimeout(550)
      await expect(page.getByText('标注当前单元格', { exact: true })).toHaveCount(0)
      await touch('pointerup', x, y); await touch('pointerup', x, y, 2)
    }
    await touch('pointerdown', x, y)
    await expect(page.getByText('标注当前单元格', { exact: true })).toBeVisible()
    await touch('pointerup', x, y); await page.keyboard.press('Escape')

    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await expect(page.getByText('标注当前单元格', { exact: true })).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.keyboard.press('Escape')
    await cdp.detach()

    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.bingTheme = theme }, theme)
      await page.getByRole('button', { name: '定位标注 3', exact: true }).click()
      const box = await cell('empty').boundingBox()
      const highlight = await page.locator('.annotation-overlay__highlight.is-object').last().boundingBox()
      expect(highlight.width).toBeGreaterThan(0)
      expect(box.width).toBeGreaterThan(0)
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
        await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `object-annotations-${theme}.png`) })
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    // 窄屏侧栏采用已有抽屉；对象边框不能把页面撑出视口。
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 1440, height: 1000 })

    // 远端正文先到、回执后到：相同复制指纹能清理原对象；正文始终保留远端修改。
    await page.evaluate(() => {
      const doc = structuredClone(JSON.parse(JSON.stringify(window.workspaceFixture.document())))
      doc.content[1].content[0].content[0].text = 'AI 更新的题注'
      window.workspaceFixture.setComparison(doc, doc)
    })
    await page.evaluate(completed => window.workspaceFixture.completeAnnotations(completed), copied.completion)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
    await expect(page.locator('.requirement-image__caption').first()).toContainText('AI 更新的题注')
    expect(errors).toEqual([])
    console.log('对象标注无头验证通过：鼠标、键盘、触屏取消、嵌套图片/合并空格、混合 v2、水平定位、输入保护和回执。')
  } finally { await context.close() }
  await verifyCalloutAnnotations(browser, url)
}

async function verifyCalloutAnnotations(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  try {
    await page.goto(url)
    await expect(page.locator('.tiptap')).toBeVisible()
    await page.evaluate(() => {
      const doc = { type: 'doc', content: [
        { type: 'paragraph', attrs: { diffId: 'outside' }, content: [{ type: 'text', text: '保留旧文字选区' }] },
        { type: 'callout', attrs: { diffId: 'notice', tone: 'note' }, content: [{ type: 'text', text: '上手路线：登录并取得项目访问权限。' }] },
        { type: 'paragraph', attrs: { diffId: 'end' } },
      ] }
      window.workspaceFixture.setComparison(doc, doc)
    })
    const notice = page.locator('.tiptap [data-diff-id="notice"]')
    await expect(notice).toContainText('上手路线')
    const original = await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))
    const select = async (id, from, to) => page.locator('.tiptap').evaluate((element, { id, from, to }) => {
      const editor = element.editor; let pos
      editor.state.doc.descendants((node, position) => { if (node.attrs.diffId === id) pos = position })
      editor.commands.setTextSelection({ from: pos + 1 + from, to: pos + 1 + to }); editor.view.dom.focus({ preventScroll: true })
    }, { id, from, to })
    const save = async comment => {
      await page.getByRole('textbox', { name: '标注修改要求' }).fill(comment)
      await page.getByRole('button', { name: '保存标注', exact: true }).click()
    }
    await select('outside', 0, 4)
    await notice.click({ button: 'right', position: { x: 4, y: 8 } })
    await page.getByText('标注提示块', { exact: true }).click()
    await save('把整个提示块改为警告')
    await expect(page.locator('.ai-annotations__section')).toContainText('提示块')
    await expect(page.locator('.annotation-overlay__highlight.is-object')).toBeVisible()
    expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)
    // 同一内联文字节点也可作文字范围标注。
    await select('notice', 0, 4)
    await page.locator('.requirement-editor__selection-menu').getByRole('button', { name: '添加 AI 标注', exact: true }).click()
    await save('补充上手路线的说明')
    await expect(page.locator('.ai-annotations__card')).toHaveCount(2)
    await page.getByRole('button', { name: '复制给 AI', exact: true }).click()
    await expect(page.getByText('AI 标注已复制', { exact: true })).toBeVisible()
    const copied = parseAnnotationRequest(await page.evaluate(() => navigator.clipboard.readText()))
    expect(copied.requirements.capabilitiesVersion).toBe(8)
    expect(copied.annotations[0].target).toMatchObject({ type: 'node', nodeType: 'callout', blockId: 'notice' })
    expect(copied.annotations[1].segments[0].blockType).toBe('callout')
    expect(resolveAnnotationRequest(copied, { id: 'fixture', schemaVersion: 3, contentToken: copied.contentToken, contentJson: JSON.parse(original) }, copied.document.origin)).toMatchObject({ ready: true, topLevelIds: ['notice'] })

    // 键盘从提示块光标命中；取消填写不改变正文与已有标注。
    await select('notice', 6, 6)
    await page.keyboard.press('Shift+F10')
    await page.getByText('标注提示块', { exact: true }).click()
    await page.getByRole('button', { name: '取消标注', exact: true }).click()
    await expect(page.locator('.ai-annotations__card')).toHaveCount(2)
    await select('notice', 0, 2)
    await page.keyboard.insertText('改')
    const confirmation = page.getByRole('dialog', { name: '修改标注原文', exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: '取消', exact: true }).click()
    expect(await page.evaluate(() => JSON.stringify(window.workspaceFixture.document()))).toBe(original)

    // 新节点使用默认留白长按，不占用文字长按。
    await notice.scrollIntoViewIfNeeded()
    const box = await notice.boundingBox(), x = box.x + 4, y = box.y + 6
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await expect(page.getByText('标注提示块', { exact: true })).toBeVisible()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.keyboard.press('Escape'); await cdp.detach()
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.bingTheme = theme }, theme)
      await page.getByRole('button', { name: '定位标注 1', exact: true }).click()
      await expect(page.locator('.annotation-overlay__highlight.is-object')).toBeVisible()
      if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
        await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.BROWSER_TEST_ARTIFACT_DIR, `callout-annotations-${theme}.png`) })
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 1440, height: 1000 })

    // 模拟后端更新语气后返回成功回执；旧原文摘要仍是清理依据。
    await page.evaluate(completed => {
      const doc = structuredClone(JSON.parse(JSON.stringify(window.workspaceFixture.document())))
      doc.content[1].attrs.tone = 'warning'
      doc.content[1].content[0].text = 'AI 更新后的警告说明'
      window.workspaceFixture.setComparison(doc, doc)
      window.workspaceFixture.completeAnnotations(completed)
    }, copied.completion)
    await expect(page.locator('.ai-annotations__card')).toHaveCount(0)
    await expect(notice).toHaveAttribute('data-tone', 'warning')
    expect(errors).toEqual([])
    console.log('通用提示块无头验证通过：整块/文字、右键/键盘/触屏、定位、编辑保护、v2 复制和完成回执。')
  } finally { await context.close() }
}
