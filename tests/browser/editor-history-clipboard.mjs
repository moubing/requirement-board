import { createRequire } from 'node:module'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { verifyTypingMarks } from './editor-typing-marks.mjs'
import { verifyImageCopy } from './editor-image-copy.mjs'
import { verifyImageCaptionSelection } from './editor-image-caption.mjs'
import { verifyCollaborativeBlockIds } from './editor-collaboration-block-ids.mjs'
import { verifyImageResize } from './editor-image-resize.mjs'
import { verifyImageResizeCaret } from './editor-image-caret.mjs'
import { verifyImageUploadCaret } from './editor-upload-caret.mjs'
import { verifyMultipleImageUploads } from './editor-multiple-uploads.mjs'
import { checkUiWorkspace } from '../../scripts/check-ui-workspace.mjs'
import { verifyPassiveLoading } from './editor-passive-loading.mjs'
import { verifyContextMenuCaret } from './editor-context-caret.mjs'
import { verifyCollaborativeVersionMarkers } from './version-markers.mjs'
import { verifyEditorNodeVisuals } from './node-visuals.mjs'
import { verifyEditorFonts } from './font-settings.mjs'
import { verifyEditorCallouts, verifyCalloutSync } from './callouts.mjs'
import { verifyEditorCodeBlocks } from './code-blocks.mjs'
import { measureCodeBlocks } from './code-blocks-performance.mjs'
import { verifyEditorChapterLinks } from './chapter-links.mjs'
import { verifyEditorTableColumns } from './table-columns.mjs'
import { verifySlashCommands, verifySlashMenuLayout } from './slash-commands.mjs'
import { verifyEditorTaskLists } from './task-lists.mjs'
import { verifyEditorDetails } from './details.mjs'
import { execFileSync } from 'node:child_process'

// 复用 Vitest / Nuxt 已安装的 Vite 与 Vue 编译器；只挂载真实编辑器，不构建应用或连接数据库。
const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vitest'))
const nuxtRequire = createRequire(import.meta.resolve('nuxt'))
const vueRequire = createRequire(nuxtRequire.resolve('@nuxt/vite-builder'))
const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(vueRequire.resolve('@vitejs/plugin-vue')).href)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const uiCandidate = process.env.BROWSER_TEST_UI_CANDIDATE === '1' ? await checkUiWorkspace() : null
const codeBaseline = new Map()
if (process.env.BROWSER_TEST_SCENARIO === 'code-performance' && process.env.BROWSER_TEST_CODE_BASELINE) {
  const commit = process.env.BROWSER_TEST_CODE_BASELINE
  if (!/^[a-f0-9]{7,40}$/.test(commit)) throw new Error('代码块基线必须是已核验的提交 SHA')
  for (const path of ['app/components/editor/scrollbar-node-views.ts', 'app/assets/css/main.css', 'app/assets/css/preferences.css']) {
    codeBaseline.set(`${root.replaceAll('\\', '/')}/${path}`, execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true }))
  }
}
const cacheDir = await mkdtemp(join(tmpdir(), 'requirement-editor-browser-'))
let server
let browser

try {
  server = await createServer({
    configFile: false, root, cacheDir,
    plugins: [{
      name: 'editor-fixture-auto-imports', enforce: 'pre',
      transform(code, id) {
        if (codeBaseline.has(id)) return codeBaseline.get(id)
        if (!id.endsWith('/RichRequirementEditor.vue')) return
        return code.replace('<script setup lang="ts">', '<script setup lang="ts">\nimport { inject } from "vue"\nconst useRequirementReadingPosition = () => {}')
      },
    }, vue()],
    resolve: {
      dedupe: ['vue', 'gsap'],
      alias: { '~~': root, '~': join(root, 'app'), '#shared': join(root, 'shared'), ofetch: join(dirname(nuxtRequire.resolve('ofetch/package.json')), 'dist/index.mjs'),
        ...(uiCandidate ? {
          '@moubing/bing-ui/style.css': join(uiCandidate.bingUi, 'dist/bing-ui.css'),
          '@moubing/bing-ui': join(uiCandidate.bingUi, 'dist/index.js'),
        } : {}) },
    },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_TEST_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}tests/browser/editor-fixture.html`)
  await page.waitForFunction(() => Boolean(window.editorFixture))
  if (process.env.BROWSER_TEST_SCENARIO === 'details') {
    await verifyEditorDetails(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'task-lists') {
    await verifyEditorTaskLists(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'slash-commands') {
    await verifySlashCommands(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'slash-layout') {
    await verifySlashMenuLayout(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'table-columns') {
    await verifyEditorTableColumns(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'chapter-links') {
    await verifyEditorChapterLinks(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'code-performance') {
    await measureCodeBlocks(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'code-blocks') {
    await verifyEditorCodeBlocks(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'passive-loading') {
    await verifyPassiveLoading(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'callout-sync') {
    await verifyCalloutSync(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'callouts') {
    await verifyEditorCallouts(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'fonts') {
    await verifyEditorFonts(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'node-visuals') {
    await verifyEditorNodeVisuals(page)
  } else if (process.env.BROWSER_TEST_SCENARIO === 'version-markers') {
    await verifyCollaborativeVersionMarkers(browser, `${server.resolvedUrls.local[0]}tests/browser/editor-fixture.html`)
  } else {
  await verifyContextMenuCaret(page)
  if (process.env.BROWSER_TEST_SCENARIO !== 'context-caret') {
  await verifyEditorCallouts(page)
  await verifyEditorTaskLists(page)
  await verifyEditorDetails(page)
  await verifySlashCommands(page)
  await verifyEditorTableColumns(page)
  await verifyEditorFonts(page)
  await verifyEditorNodeVisuals(page)
  await verifyMultipleImageUploads(page)
  await verifyImageUploadCaret(page)
  await verifyPassiveLoading(page)
  await verifyCollaborativeBlockIds(page)
  await verifyTypingMarks(page)
  await verifyImageCopy(page)
  await verifyImageCaptionSelection(page)
  await verifyImageResize(page)
  await verifyImageResizeCaret(page)

  for (const collaborative of [false, true]) {
    await page.evaluate(collaborative => window.editorFixture.mount(collaborative, {
      type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'readonly_toggle' }, content: [{ type: 'text', text: '只读恢复' }] }],
    }), collaborative)
    const body = page.locator('.tiptap')
    await body.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('保留输入')
    const before = await page.evaluate(() => ({ updates: window.editorFixture.modelUpdates, json: window.editorFixture.editor().getJSON() }))
    await page.evaluate(() => window.editorFixture.setDisabled(true))
    await expect(body).toHaveAttribute('contenteditable', 'false')
    await body.click(); await page.keyboard.insertText('不可插入')
    await page.evaluate(() => window.editorFixture.setDisabled(false))
    await expect(body).toHaveAttribute('contenteditable', 'true')
    expect(await page.evaluate(() => window.editorFixture.modelUpdates), '只读切换不回传全文').toBe(before.updates)
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before.json)
    await body.click(); await page.keyboard.press('Control+z')
    await expect(body).toHaveText('只读恢复')
    await page.keyboard.press('Control+Shift+z')
    await expect(body).toHaveText('只读恢复保留输入')
  }
  console.log('通过：普通和协作编辑器只读切换不产生全文更新，输入保护及撤销/重做保留。')

  const sample = { type: 'doc', content: [
    { type: 'orderedList', attrs: { diffId: 'list_source', start: 1 }, content: [
      { type: 'listItem', attrs: { diffId: 'item_source' }, content: [{ type: 'paragraph', attrs: { diffId: 'para_source' }, content: [{ type: 'text', text: '东方今典上课了佛挡杀佛' }] }] },
    ] },
    { type: 'paragraph', attrs: { diffId: 'para_sentence' }, content: [{ type: 'text', text: '电风扇答复' }] },
    { type: 'paragraph', attrs: { diffId: 'para_target' } },
  ] }
  await page.evaluate(content => window.editorFixture.mount(true, content), sample)
  // 全局 Cursor 必须保留编辑器接管的正文 DOM，否则 ProseMirror 会持续重建段落。
  const paragraph = page.locator('.tiptap li p').first()
  const originalParagraph = await paragraph.elementHandle()
  await paragraph.hover()
  await expect(paragraph).toHaveCSS('cursor', /, text$/)
  await page.waitForTimeout(200)
  expect(await originalParagraph.evaluate(node => node.isConnected)).toBe(true)
  expect(await page.locator('.tiptap [data-bing-cursor-native]').count()).toBe(0)
  await expect(page.locator('.tiptap')).toHaveAttribute('data-bing-cursor-native', /(?:text|editable)$/)
  await page.locator('.tiptap').click()
  await page.evaluate(() => {
    const editor = window.editorFixture.editor()
    editor.commands.setTextSelection({ from: 3, to: editor.state.doc.content.size - 3 })
  })
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0]
    return { text: await (await item.getType('text/plain')).text(), html: await (await item.getType('text/html')).text() }
  })
  expect(copied.text).toBe('东方今典上课了佛挡杀佛\n电风扇答复')
  expect(copied.html).toContain('data-pm-slice="3 1 []"')
  await page.evaluate(() => {
    const editor = window.editorFixture.editor()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  })
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.doc.childCount)).toBe(4)
  const once = await page.evaluate(() => window.editorFixture.editor().getJSON())
  expect(once.content.map(node => node.type)).toEqual(['orderedList', 'paragraph', 'orderedList', 'paragraph'])
  expect(once.content[0].attrs.diffId).toBe('list_source')
  expect(once.content[2].attrs.diffId).not.toBe('list_source')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.doc.childCount)).toBe(6)
  expect(await page.evaluate(() => [...window.editorFixture.editor().view.dom.querySelectorAll('p')].every(p => Boolean(p.textContent)))).toBe(true)

  // Windows Chrome 真实粘贴事件中的 CF_HTML 包装（无头剪贴板不会自动附加）。
  await page.evaluate(() => window.editorFixture.mount(true, { type: 'doc', content: [{ type: 'paragraph' }] }))
  await page.locator('.tiptap').click()
  await page.evaluate(({ html, text }) => {
    const data = new DataTransfer()
    data.setData('text/html', `<html>\r\n<body>\r\n<!--StartFragment-->${html}<!--EndFragment-->\r\n</body>\r\n</html>`)
    data.setData('text/plain', text)
    window.editorFixture.editor().view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
  }, copied)
  const windowsPaste = await page.evaluate(() => window.editorFixture.editor().getJSON())
  expect(windowsPaste.content.map(node => node.type)).toEqual(['orderedList', 'paragraph'])
  expect(JSON.stringify(windowsPaste)).not.toContain('hardBreak')

  // 原生和异步 ClipboardItem 两种右键复制路径，都必须保留列表和选区边界。
  for (const fallback of [false, true]) {
    console.log(`验证右键复制（异步回退：${fallback}）`)
    await page.evaluate(content => window.editorFixture.mount(true, content), sample)
    await page.locator('.tiptap').click()
    await page.evaluate(forceFallback => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection({ from: 3, to: editor.state.doc.content.size - 3 })
      if (forceFallback) document.execCommand = () => false
    }, fallback)
    await page.evaluate(() => navigator.clipboard.writeText('等待本次复制'))
    await page.locator('.tiptap li p').click({ button: 'right', position: { x: 20, y: 10 } })
    await page.getByRole('menuitem', { name: /^复制/ }).click()
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n?/g, '\n'))).toBe(copied.text)
    const html = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text())
    expect(html).toContain('data-pm-slice="3 1 []"')
  }

  // 同一异步回退用于剪切，确认写入成功后再删除，且整个删除可以撤销。
  await page.evaluate(content => window.editorFixture.mount(true, content), sample)
  await page.locator('.tiptap').click()
  const cutBefore = await page.evaluate(() => {
    const editor = window.editorFixture.editor()
    editor.commands.selectAll()
    return editor.getJSON()
  })
  await page.locator('.tiptap li p').click({ button: 'right', position: { x: 20, y: 10 } })
  await page.getByRole('menuitem', { name: /^剪切/ }).click()
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.doc.textContent)).toBe('')
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(cutBefore)

  const initial = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'initial' }, content: [{ type: 'text', text: '原有正文' }] }] }
  for (const collaborative of [false, true]) {
    console.log(`验证粘贴列表接续编号（协作：${collaborative}）`)
    await page.evaluate(({ collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [
      { type: 'orderedList', attrs: { diffId: 'numbered_original', start: 5 }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }] },
      ] },
      { type: 'paragraph' },
    ] }), { collaborative })
    await page.locator('.tiptap').click()
    const beforeListPaste = await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection({ from: 3, to: editor.state.doc.firstChild.nodeSize - 3 })
      return editor.getJSON()
    })
    await page.keyboard.press('Control+c')
    for (const count of [4, 6]) {
      await page.evaluate(() => {
        const editor = window.editorFixture.editor()
        window.editorFixture.separateHistory()
        editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      })
      await page.keyboard.press('Control+v')
      await expect(page.locator('.tiptap ol')).toHaveCount(1)
      await expect(page.locator('.tiptap ol')).toHaveAttribute('start', '5')
      await expect(page.locator('.tiptap ol > li')).toHaveCount(count)
      const pastedList = await page.evaluate(() => window.editorFixture.editor().getJSON())
      expect(pastedList.content[0].attrs.diffId).toBe('numbered_original')
      if (count === 4) {
        await page.keyboard.press('Control+z')
        await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(beforeListPaste)
        await page.keyboard.press('Control+y')
        await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(pastedList)
      }
    }

    for (const type of ['paragraph', 'orderedList', 'bulletList']) {
      console.log(`验证 ${type} 撤销/重做（协作：${collaborative}）`)
      await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content: initial })
      await page.locator('.tiptap').click()
      await page.keyboard.press('Control+End')
      if (type !== 'paragraph') {
        await page.getByRole('button', { name: type === 'orderedList' ? '有序列表' : '无序列表', exact: true }).click()
        // Tiptap 的 focus 在下一帧执行；此时按 Enter 会再次激活工具栏按钮。
        await expect(page.locator('.tiptap')).toBeFocused()
      }
      const before = await page.evaluate(() => window.editorFixture.editor().getJSON())
      await page.evaluate(() => window.editorFixture.separateHistory())
      await page.keyboard.press('Enter')
      const split = await page.evaluate(() => window.editorFixture.editor().getJSON())
      if (type !== 'paragraph') expect(split.content[0].content).toHaveLength(2)
      await page.evaluate(() => window.editorFixture.separateHistory())
      await page.keyboard.insertText('继续输入')
      const typed = await page.evaluate(() => window.editorFixture.editor().getJSON())
      await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
      await page.getByRole('menuitem', { name: '撤销（Ctrl+Z）', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(split)
      await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
      await page.getByRole('menuitem', { name: '撤销（Ctrl+Z）', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before)
      await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
      await page.getByRole('menuitem', { name: '重做（Ctrl+Y）', exact: true }).click()
      await page.getByRole('button', { name: '更多格式工具', exact: true }).click()
      await page.getByRole('menuitem', { name: '重做（Ctrl+Y）', exact: true }).click()
      await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(typed)
    }
  }

  // 使用真实图片 NodeView 和题注导航验证结构重做，不依赖网络上传。
  await page.route('**/uploads/editor-fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="skyblue"/></svg>' }))
  await page.evaluate(content => window.editorFixture.mount(true, content), initial)
  const imageBefore = await page.evaluate(() => {
    const editor = window.editorFixture.editor()
    editor.commands.setTextSelection(3)
    const before = editor.getJSON()
    editor.commands.insertContent({ type: 'image', attrs: { src: '/uploads/editor-fixture.svg', diffId: 'image_fixture', width: 120, height: 60 }, content: [{ type: 'imageCaption' }] })
    window.editorFixture.separateHistory()
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.view.focus()
    return before
  })
  await page.keyboard.insertText('图片之后继续输入')
  const imageTyped = await page.evaluate(() => window.editorFixture.editor().getJSON())
  await page.keyboard.press('Control+z')
  await expect(page.locator('.requirement-image')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(imageBefore)
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+y')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(imageTyped)

  // 从图片本身拖动，必须走 ProseMirror 的节点移动，不能导入带尺寸提示的 NodeView DOM。
  await page.evaluate(() => window.editorFixture.mount(true, { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '图片上方' }] },
    { type: 'image', attrs: { src: '/uploads/editor-fixture.svg', diffId: 'image_move', width: 240, height: 120, align: 'center' },
      content: [{ type: 'imageCaption', content: [{ type: 'text', text: '拖动题注' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '移动目标' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '文末' }] },
  ] }))
  await expect(page.locator('.requirement-image img').first()).toBeVisible()
  const beforeDrag = await page.evaluate(() => {
    window.editorFixture.separateHistory()
    return window.editorFixture.editor().getJSON()
  })
  await page.evaluate(() => {
    window.dragAudit = []
    document.addEventListener('dragstart', event => window.dragAudit.push({
      type: event.type, target: event.target.tagName, dragging: Boolean(window.editorFixture.editor().view.dragging),
      editorSlice: event.dataTransfer?.getData('text/html').includes('data-pm-slice'), prevented: event.defaultPrevented,
    }))
  })
  const dragStart = await page.locator('.requirement-image__preview-trigger').boundingBox()
  const dragEnd = await page.locator('.tiptap p').filter({ hasText: '移动目标' }).boundingBox()
  await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + dragStart.width / 2 + 20, dragStart.y + dragStart.height / 2 + 20, { steps: 5 })
  await page.mouse.move(dragEnd.x + dragEnd.width - 10, dragEnd.y + dragEnd.height / 2, { steps: 10 })
  await page.mouse.up()
  const dragAudit = await page.evaluate(() => window.dragAudit)
  expect(dragAudit).toEqual([expect.objectContaining({ dragging: true, editorSlice: true, prevented: false })])
  await expect(page.locator('.requirement-image')).toHaveCount(1)
  const movedImage = await page.evaluate(() => window.editorFixture.editor().getJSON())
  expect(movedImage.content.map(node => node.type)).toEqual(['paragraph', 'paragraph', 'image', 'paragraph'])
  expect(movedImage.content.filter(node => node.type === 'image')).toEqual([expect.objectContaining({ attrs: expect.objectContaining({ diffId: 'image_move', src: '/uploads/editor-fixture.svg' }) })])
  expect(await page.evaluate(() => window.editorFixture.editor().state.doc.textContent)).not.toContain('240 × 120')
  expect(movedImage.content.find(node => node.type === 'image').content).toEqual(beforeDrag.content.find(node => node.type === 'image').content)
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(beforeDrag)
  await page.keyboard.press('Control+y')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(movedImage)

  await page.evaluate(() => navigator.clipboard.writeText('1. **列表内容**\n\n下面一句话'))
  await page.evaluate(() => window.editorFixture.mount(true, { type: 'doc', content: [{ type: 'paragraph' }] }))
  await page.locator('.tiptap').click()
  await page.keyboard.press('Control+v')
  await expect(page.locator('.tiptap ol')).toHaveCount(1)
  await expect(page.locator('.tiptap strong')).toHaveText('列表内容')
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.doc.childCount)).toBe(2)
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+Shift+v')
  await expect(page.locator('.tiptap ol')).toHaveCount(0)
  await expect(page.locator('.tiptap strong')).toHaveCount(0)
  await expect(page.locator('.tiptap')).toContainText('**列表内容**')

  await page.evaluate(() => navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob(['<p><strong>**字面文本**</strong></p>'], { type: 'text/html' }),
    'text/plain': new Blob(['**字面文本**'], { type: 'text/plain' }),
  })]))
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.tiptap strong')).toHaveText('**字面文本**')
  expect(await page.evaluate(() => window.editorFixture.errors)).toEqual([])
  expect(errors).toEqual([])
  console.log('通过：协作加载及 AI 建议采纳后的块标识与保存校验、真实编辑器连续撤销/重做、段落和两类列表、图片 NodeView 移动及撤销、Windows 剪贴板包装、重复富文本粘贴、右键复制/剪切及异步回退、Markdown 和纯文本快捷键；无浏览器异常。')
  }
  }
  expect(errors).toEqual([])
} finally {
  await browser?.close()
  await server?.close()
  const actual = await realpath(cacheDir)
  const parent = await realpath(tmpdir())
  if (!actual.startsWith(parent + sep) || !actual.includes('requirement-editor-browser-')) throw new Error('拒绝清理范围外目录')
  await rm(actual, { recursive: true })
}
