import { expect } from '@playwright/test'

export async function verifyImageResizeCaret(page) {
  const originalViewport = page.viewportSize()
  const src = '/uploads/resize-caret.svg'
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.route(`**${src}`, route => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="250"><rect width="100%" height="100%" fill="#396fa5"/></svg>' }))
  try {
    for (const collaborative of [false, true]) {
      await page.evaluate(({ collaborative, src }) => window.editorFixture.mount(collaborative, {
        type: 'doc', content: [
          { type: 'paragraph', attrs: { diffId: 'caret-before' }, content: [{ type: 'text', text: '图片之前' }] },
          { type: 'image', attrs: { width: 500, height: 250, src, align: 'center', diffId: 'caret-image' },
            content: [{ type: 'imageCaption', content: [{ type: 'text', text: '图片题注' }] }] },
          { type: 'paragraph', attrs: { diffId: 'caret-after' }, content: [{ type: 'text', text: '图片下方的输入位置' }] },
        ],
      }), { collaborative, src })
      await expect.poll(() => page.locator('.requirement-image img').evaluate(image => image.complete && image.naturalWidth)).toBe(500)
      await page.locator('[data-diff-id="caret-after"]').click()
      await page.keyboard.press('End')
      await expect.poll(() => page.evaluate(() => {
        const editor = window.editorFixture.editor()
        return editor.state.selection.head === editor.state.doc.content.size - 1
      })).toBe(true)
      const selection = await page.evaluate(() => window.editorFixture.editor().state.selection.toJSON())
      const caret = page.locator('.requirement-editor__smooth-caret')
      await expect(caret).toHaveClass(/--visible/)
      await expect(caret).toHaveClass(/--blinking/)
      await expect(caret).toHaveCSS('opacity', '0')
      await page.locator('.requirement-image').hover()
      const handle = page.locator('.bing-resizable__handle--bottom-right')
      const box = await handle.boundingBox()
      const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(origin.x, origin.y)
      await page.mouse.down()
      const samples = []
      for (const distance of [20, 40, 60, 80, 100, 120, 140, 160, 140, 120, 100, 80, 60, 40, 20, 0]) {
        await page.mouse.move(origin.x + distance, origin.y + distance / 2)
        samples.push(await page.evaluate(async () => {
          await new Promise(requestAnimationFrame)
          const editor = window.editorFixture.editor()
          const caret = document.querySelector('.requirement-editor__smooth-caret')
          const coords = editor.view.coordsAtPos(editor.state.selection.head, 1)
          const rect = caret.getBoundingClientRect()
          return { lag: Math.abs(rect.top - coords.top - 1), opacity: Number(getComputedStyle(caret).opacity),
            focused: editor.view.hasFocus(), visible: caret.classList.contains('requirement-editor__smooth-caret--visible'),
            flip: document.querySelectorAll('style[data-document-layout-motion-style]').length }
        }))
      }
      // 停住指针但不松手：超过原来的闪烁周期仍保持常亮。
      const pausedOpacity = await caret.evaluate(async node => {
        const values = []
        const start = performance.now()
        while (performance.now() - start < 1100) {
          await new Promise(requestAnimationFrame)
          values.push(Number(getComputedStyle(node).opacity))
        }
        return Math.min(...values)
      })
      await page.mouse.up()
      expect(Math.max(...samples.map(sample => sample.lag)), '连续缩放时光标贴合文本，不反复追赶旧位置').toBeLessThanOrEqual(2)
      expect(samples.every(sample => sample.focused && sample.visible && sample.flip === 0)).toBe(true)
      expect(Math.min(...samples.map(sample => sample.opacity)), '拖动时不因旧闪烁周期出现明暗跳变').toBe(1)
      expect(pausedOpacity).toBe(1)
      expect(await page.evaluate(() => window.editorFixture.editor().state.selection.toJSON())).toEqual(selection)
      await expect(caret).toHaveClass(/--smooth/)
      await expect(caret).toHaveClass(/--blinking/)
      await page.keyboard.insertText('继续输入')
      await expect(page.locator('[data-diff-id="caret-after"]')).toHaveText('图片下方的输入位置继续输入')
      console.log(`通过：图片连续缩放时光标逐帧贴合、常亮及输入恢复（协作：${collaborative}，最大偏差 ${Math.max(...samples.map(sample => sample.lag)).toFixed(2)}px）。`)

      for (const ending of ['Escape', 'pointercancel', 'blur', 'pointerout', 'inactive']) {
        await page.locator('.requirement-image').hover()
        const box = await handle.boundingBox()
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x + 12, y + 6)
        await expect(caret).not.toHaveClass(/--smooth|--blinking/)
        if (ending === 'Escape') await page.keyboard.press('Escape')
        else if (ending === 'inactive') {
          await page.evaluate(() => window.editorFixture.setActive(false))
          await expect(caret).not.toHaveClass(/--visible/)
        } else {
          await page.evaluate(ending => window.dispatchEvent(ending === 'blur' ? new Event('blur')
            : new PointerEvent(ending, { clientX: -1, clientY: -1, pointerId: 1 })), ending)
        }
        if (ending !== 'inactive') {
          await expect(caret).toHaveClass(/--smooth/)
          await expect(caret).toHaveClass(/--blinking/)
        }
        await page.mouse.up()
        if (ending === 'inactive') {
          await page.evaluate(() => window.editorFixture.setActive(true))
          await page.locator('[data-diff-id="caret-after"]').click()
          await expect(caret).toHaveClass(/--smooth/)
          await expect(caret).toHaveClass(/--blinking/)
        }
      }
    }
  } finally {
    await page.mouse.up()
    await page.unroute(`**${src}`)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize(originalViewport)
  }
}
