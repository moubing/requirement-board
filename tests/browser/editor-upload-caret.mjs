import { expect } from '@playwright/test'

export async function verifyImageUploadCaret(page) {
  const originalViewport = page.viewportSize()
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  let pendingRoute
  await page.route('**/api/assets/upload?*', route => { pendingRoute = route })
  const imagePath = '/uploads/caret-upload.png'
  const imageBytes = await page.evaluate(async () => {
    // Vite 夹具没有 Nuxt 的全局 $fetch，保留真实 fetch 与 AbortSignal，交由 Playwright 控制网络响应。
    window.uploadCaretOriginalFetch = window.$fetch
    window.$fetch = async (url, options) => {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error('上传失败')
      return response.json()
    }
    const canvas = document.createElement('canvas')
    canvas.width = 500
    canvas.height = 250
    canvas.getContext('2d').fillRect(0, 0, 500, 250)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.route(`**${imagePath}`, route => route.fulfill({ contentType: 'image/png', body: Buffer.from(imageBytes, 'base64') }))
  const snapshot = () => page.evaluate(() => ({ json: window.editorFixture.editor().getJSON(),
    selection: window.editorFixture.editor().state.selection.toJSON() }))
  const assertTextCaret = async () => {
    await expect(page.locator('.requirement-editor__smooth-caret')).toHaveClass(/--visible/)
    await expect.poll(() => page.evaluate(() => {
      const caret = document.querySelector('.requirement-editor__smooth-caret').getBoundingClientRect()
      const selection = document.getSelection()
      const range = document.createRange()
      range.setStart(selection.focusNode, selection.focusOffset)
      range.collapse(true)
      const native = range.getBoundingClientRect()
      const anchor = document.querySelector('[data-image-upload-caret-anchor], [data-requirement-empty-caret-anchor]')?.getBoundingClientRect()
      const target = native.height ? native : anchor ?? window.editorFixture.editor().view.coordsAtPos(window.editorFixture.editor().state.selection.head)
      return Boolean(target && caret.height > 2 && caret.height < 40
        && Math.abs(caret.left - target.left) < 2 && Math.abs(caret.top - target.top - 1) < 2)
    }), { message: '上传占位不能成为插入光标的坐标或高度' }).toBe(true)
    expect(await page.evaluate(() => window.editorFixture.editor().view.hasFocus())).toBe(true)
  }
  const scenarios = [
    { name: '段末成功', offset: 7, outcome: 'success' },
    { name: '段中取消', offset: 3, outcome: 'cancel' },
    { name: '段首取消', offset: 0, outcome: 'cancel' },
    { name: '空段成功', offset: 0, empty: true, outcome: 'success' },
    { name: '格式边界取消', offset: 2, marked: true, outcome: 'cancel' },
    { name: '换行后取消', offset: 3, lineBreak: true, outcome: 'cancel' },
    { name: '列表成功', offset: 7, list: true, outcome: 'success' },
    { name: '失败重试', offset: 7, outcome: 'retry' },
  ]
  try {
    for (const collaborative of [false, true]) {
      for (const scenario of scenarios) {
        await page.evaluate(({ collaborative, scenario }) => {
          const paragraph = { type: 'paragraph', attrs: { diffId: 'upload-text' },
            content: scenario.empty ? [] : scenario.marked ? [
              { type: 'text', text: '正在', marks: [{ type: 'bold' }] }, { type: 'text', text: '输入的段落' },
            ] : scenario.lineBreak ? [
              { type: 'text', text: '正在' }, { type: 'hardBreak' }, { type: 'text', text: '输入的段落' },
            ] : [{ type: 'text', text: '正在输入的段落' }] }
          return window.editorFixture.mount(collaborative, { type: 'doc', content: scenario.list
            ? [{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph] }] }] : [paragraph] })
        }, { collaborative, scenario })
        await page.locator('[data-diff-id="upload-text"]').click()
        await page.evaluate(async offset => {
          const editor = window.editorFixture.editor()
          await new Promise(requestAnimationFrame)
          editor.state.doc.descendants((node, pos) => {
            if (node.attrs.diffId === 'upload-text') editor.commands.setTextSelection(pos + 1 + offset)
          })
          editor.view.focus()
        }, scenario.offset)
        await assertTextCaret()
        const before = await snapshot()
        const textBefore = await page.evaluate(() => window.editorFixture.editor().state.doc.textContent)
        await page.keyboard.press('Control+v')
        const placeholder = page.locator('.requirement-image-upload')
        await expect(placeholder).toHaveAttribute('data-status', 'uploading')
        await expect(placeholder).toHaveAttribute('data-image-upload-sized', 'true')
        await expect.poll(() => Boolean(pendingRoute)).toBe(true)
        await assertTextCaret()
        expect(await snapshot()).toEqual(before)
        // 请求一直挂起，等待一个闪烁周期后继续输入，检查占位映射与真实输入位置。
        await page.waitForTimeout(1100)
        await assertTextCaret()
        if (scenario.offset === 0) {
          const cdp = await page.context().newCDPSession(page)
          try {
            await cdp.send('Input.imeSetComposition', { text: 'jixu', selectionStart: 4, selectionEnd: 4 })
            await assertTextCaret()
            await cdp.send('Input.insertText', { text: '继续' })
          } finally { await cdp.detach() }
        } else await page.keyboard.insertText('继续')
        await assertTextCaret()
        const typed = await snapshot()
        expect(JSON.stringify(typed.json)).toContain('继续')
        expect(await page.evaluate(() => window.editorFixture.editor().state.doc.textContent.replace('继续', ''))).toBe(textBefore)
        if (scenario.outcome === 'retry') {
          await pendingRoute.fulfill({ status: 503, json: { message: '模拟慢网失败' } })
          pendingRoute = undefined
          await expect(placeholder).toHaveAttribute('data-status', 'error')
          await assertTextCaret()
          expect(await snapshot()).toEqual(typed)
          await placeholder.getByRole('button', { name: '重试', exact: true }).evaluate(button => button.click())
          await expect(placeholder).toHaveAttribute('data-status', 'uploading')
          await expect.poll(() => Boolean(pendingRoute)).toBe(true)
          await assertTextCaret()
        }
        if (scenario.outcome === 'cancel') {
          await placeholder.getByRole('button', { name: '取消', exact: true }).evaluate(button => button.click())
          await pendingRoute.abort()
          pendingRoute = undefined
          await expect(placeholder).toHaveCount(0)
          expect(await snapshot()).toEqual(typed)
          await expect(page.locator('.requirement-image')).toHaveCount(0)
        } else {
          await pendingRoute.fulfill({ json: { url: imagePath, fileName: 'image.png' } })
          pendingRoute = undefined
          await expect(placeholder).toHaveCount(0)
          await expect(page.locator('.requirement-image img')).toHaveCount(1)
        }
        await assertTextCaret()
        await page.keyboard.insertText('完成后')
        expect(await page.evaluate(() => window.editorFixture.editor().state.selection.$head.parent.type.name)).toBe('paragraph')
        if (collaborative) {
          expect(await page.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson)).toEqual((await snapshot()).json)
        }
        console.log(`通过：图片上传光标 ${scenario.name}（协作：${collaborative}）。`)
      }
    }
  } finally {
    await pendingRoute?.abort()
    await page.unroute('**/api/assets/upload?*')
    await page.unroute(`**${imagePath}`)
    await page.evaluate(() => {
      if (window.uploadCaretOriginalFetch) window.$fetch = window.uploadCaretOriginalFetch
      else delete window.$fetch
      delete window.uploadCaretOriginalFetch
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(originalViewport)
  }
}
