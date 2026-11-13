import { expect } from '@playwright/test'

export async function verifyImageCopy(page) {
  const samples = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 160
    const context = canvas.getContext('2d')
    context.fillStyle = 'rgb(32, 96, 160)'
    context.fillRect(0, 0, 160, 160)
    return ['image/png', 'image/jpeg'].map(type => ({ type, data: canvas.toDataURL(type).split(',')[1] }))
  })
  const copy = page.getByRole('button', { name: '复制图片', exact: true })
  const snapshot = () => page.evaluate(() => {
    const editor = window.editorFixture.editor()
    return { document: editor.getJSON(), selection: editor.state.selection.toJSON() }
  })
  async function mount(src, collaborative = false) {
    await page.evaluate(({ src, collaborative }) => window.editorFixture.mount(collaborative, { type: 'doc', content: [
      { type: 'paragraph', attrs: { diffId: 'copy-before' }, content: [{ type: 'text', text: '复制前的正文' }] },
      { type: 'image', attrs: { src, diffId: 'copy-image', width: 160, height: 80, align: 'center' },
        content: [{ type: 'imageCaption', content: [{ type: 'text', text: '题注不写入图片剪贴板' }] }] },
      { type: 'paragraph', attrs: { diffId: 'copy-after' } },
    ] }), { src, collaborative })
    await expect(page.locator('.requirement-image')).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(page.locator('.requirement-image__actions')).toHaveCount(0)
    const image = await page.locator('.requirement-image img').elementHandle()
    await page.getByRole('button', { name: '预览图片', exact: true }).focus()
    await expect(page.locator('.requirement-image__actions')).toHaveCount(1)
    await page.locator('.tiptap > p').first().click()
    await page.mouse.move(0, 0)
    await expect(page.locator('.requirement-image__actions')).toHaveCount(0)
    await page.locator('.requirement-image').hover()
    await expect(page.locator('.requirement-image__actions')).toHaveCount(1)
    expect(await image.evaluate(node => node.isConnected)).toBe(true)
    await image.dispose()
  }

  for (const [index, sample] of samples.entries()) {
    const path = `/uploads/image-copy-${index}`
    await page.route(`**${path}`, route => route.fulfill({ contentType: sample.type, body: Buffer.from(sample.data, 'base64') }))
    await mount(path, index === 1)
    await expect.poll(() => page.locator('.requirement-image img').evaluate(image => image.complete && image.naturalWidth)).toBe(320)
    const original = (await snapshot()).document
    await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.chain().focus().setTextSelection(2).insertContent('已有编辑').run()
      window.editorFixture.separateHistory()
      editor.commands.setTextSelection({ from: 2, to: 4 })
    })
    const before = await snapshot()
    // 编辑器聚焦可能滚动图片；工具条现在只在真实交互区域按需创建。
    await page.locator('.requirement-image').hover()
    if (index === 1) {
      await copy.focus()
      await copy.press('Enter')
    } else await copy.click()
    await expect(page.getByText('图片已复制', { exact: true })).toBeVisible()
    expect(await snapshot()).toEqual(before)

    const clipboard = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0]
      const blob = await item.getType('image/png')
      const image = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const result = { types: item.types, width: image.width, height: image.height,
        color: [...context.getImageData(40, 40, 1, 1).data], alpha: context.getImageData(280, 40, 1, 1).data[3] }
      image.close()
      return result
    })
    expect(clipboard.types).toEqual(['image/png'])
    expect([clipboard.width, clipboard.height]).toEqual([320, 160])
    expect(clipboard.alpha).toBe(index === 0 ? 0 : 255)
    for (const [channel, value] of [32, 96, 160, 255].entries()) expect(Math.abs(clipboard.color[channel] - value)).toBeLessThanOrEqual(2)
    await page.evaluate(() => window.editorFixture.editor().commands.undo())
    await expect.poll(async () => (await snapshot()).document).toEqual(original)
    await page.evaluate(() => window.editorFixture.editor().commands.redo())
    await expect.poll(async () => (await snapshot()).document).toEqual(before.document)

    // 真实系统粘贴事件应携带图片文件，不能只有图片地址或题注。
    await page.evaluate(() => {
      const target = document.createElement('div')
      target.contentEditable = 'true'
      target.setAttribute('aria-label', '图片粘贴验证')
      target.style.cssText = 'position:fixed;bottom:0;left:0;width:240px;height:40px;background:white;z-index:9999'
      target.addEventListener('paste', event => {
        event.preventDefault()
        window.imageCopyPaste = [...event.clipboardData.files].map(file => ({ type: file.type, size: file.size }))
      })
      window.imageCopyPaste = null
      document.body.append(target)
    })
    const target = page.getByLabel('图片粘贴验证', { exact: true })
    await target.focus()
    await page.keyboard.press('Control+v')
    await expect.poll(() => page.evaluate(() => window.imageCopyPaste)).toEqual([{ type: 'image/png', size: expect.any(Number) }])
    expect(await page.evaluate(() => window.imageCopyPaste[0].size)).toBeGreaterThan(0)
    await target.evaluate(element => element.remove())
  }

  await page.evaluate(() => {
    window.editorFixture.clearToasts()
    window.originalImageClipboardWrite = navigator.clipboard.write
    window.imageCopyCalls = 0
    navigator.clipboard.write = () => {
      window.imageCopyCalls++
      return new Promise((_resolve, reject) => { window.rejectImageCopy = reject })
    }
  })
  try {
    await page.locator('.requirement-image').hover()
    await copy.click()
    await expect(copy).toBeDisabled()
    await copy.evaluate(button => button.click())
    expect(await page.evaluate(() => window.imageCopyCalls)).toBe(1)
    await page.evaluate(() => window.rejectImageCopy(new DOMException('拒绝剪贴板访问', 'NotAllowedError')))
    await expect(page.getByRole('alert')).toContainText('请允许浏览器访问剪贴板后重试')
    await expect(copy).toBeEnabled()
    await expect(page.getByText('图片已复制', { exact: true })).toHaveCount(0)

    await page.evaluate(() => {
      window.editorFixture.clearToasts()
      navigator.clipboard.write = undefined
    })
    await copy.click()
    await expect(page.getByRole('alert')).toContainText('当前浏览器不支持复制图片')
    await expect(copy).toBeEnabled()
  } finally {
    await page.evaluate(() => {
      navigator.clipboard.write = window.originalImageClipboardWrite
      delete window.originalImageClipboardWrite
      delete window.rejectImageCopy
      delete window.imageCopyCalls
      delete window.imageCopyPaste
    })
  }

  await page.route('**/uploads/image-copy-missing', route => route.fulfill({ status: 404, body: '' }))
  await mount('/uploads/image-copy-missing')
  const beforeFailure = await snapshot()
  await copy.click()
  await expect(page.getByRole('alert')).toContainText('图片尚未加载完成')
  expect(await snapshot()).toEqual(beforeFailure)
  await expect(copy).toBeEnabled()
  await mount('/uploads/image-copy-0')
  const image = await page.locator('.requirement-image img').elementHandle()
  const right = page.locator('.requirement-image .bing-resizable__handle--right')
  await right.focus(); await right.press('ArrowRight')
  await expect.poll(async () => (await snapshot()).document.content.find(node => node.type === 'image').attrs.width).toBeGreaterThan(160)
  const beforeResize = (await snapshot()).document.content.find(node => node.type === 'image').attrs.width
  const handle = await right.boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => (await snapshot()).document.content.find(node => node.type === 'image').attrs.width).toBeGreaterThan(beforeResize)
  await page.getByRole('button', { name: '图片居右', exact: true }).click()
  await expect(page.locator('.requirement-image')).toHaveAttribute('data-image-align', 'right')
  await page.locator('.requirement-image__caption').click()
  await expect(page.locator('.tiptap')).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('imageCaption')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'tizhu', selectionStart: 5, selectionEnd: 5 })
  await cdp.send('Input.insertText', { text: '中文题注' })
  await cdp.detach()
  await expect(page.locator('.requirement-image__caption')).toContainText('中文题注')
  await page.evaluate(() => window.editorFixture.setActive(false))
  await expect(page.locator('.requirement-image__actions')).toHaveCount(0)
  await page.evaluate(() => window.editorFixture.setActive(true))
  await page.getByRole('button', { name: '预览图片', exact: true }).focus()
  await expect(page.locator('.requirement-image__actions')).toHaveCount(1)
  expect(await image.evaluate(node => node.isConnected)).toBe(true)
  await image.dispose()
  console.log('通过：图片按钮鼠标/键盘复制、PNG/JPEG、原始尺寸与透明度、真实系统图片粘贴、选区及撤销保持、重复点击、权限拒绝和图片加载失败。')
  console.log('通过：图片工具条按需挂载、键盘与拖拽缩放、对齐、题注原生中文组词、隐藏/恢复期间图片 DOM 稳定。')
}
