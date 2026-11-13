import { expect } from '@playwright/test'

export async function verifyImageCaptionSelection(page) {
  const src = '/uploads/caption-selection.svg'
  const text = '已有题注文字用于拖选'
  await page.route(`**${src}`, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="skyblue"/></svg>',
  }))
  const caption = page.locator('.requirement-image__caption')
  const content = caption.locator('[data-image-caption-content]')
  const body = page.locator('.tiptap')
  const documentJson = () => page.evaluate(() => window.editorFixture.editor().getJSON())

  async function captionPoint(offset) {
    await caption.scrollIntoViewIfNeeded()
    return content.evaluate((element, offset) => {
      const range = document.createRange()
      range.setStart(element.firstChild, offset)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      return { x: rect.left, y: rect.top + rect.height / 2 }
    }, offset)
  }

  async function enterCaption(offset) {
    if (offset === undefined) await caption.click()
    else {
      const point = await captionPoint(offset)
      await page.mouse.click(point.x, point.y)
    }
    await expect(body).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('imageCaption')
    if (offset !== undefined) {
      await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.selection.$from.parentOffset)).toBe(offset)
    }
  }

  async function selectCaption(from, to, expected) {
    const start = await captionPoint(from)
    const end = await captionPoint(to)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 15 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(expected)
    await expect.poll(() => page.evaluate(() => {
      const { selection, doc } = window.editorFixture.editor().state
      return { from: selection.$from.parentOffset, to: selection.$to.parentOffset,
        parent: selection.$from.parent.type.name, text: doc.textBetween(selection.from, selection.to) }
    })).toEqual({ from: Math.min(from, to), to: Math.max(from, to), parent: 'imageCaption', text: expected })
  }

  for (const collaborative of [false, true]) {
    for (const scenario of ['existing', 'typed', 'empty-return', 'pasted']) {
      console.log(`验证题注鼠标选区：${scenario}（协作：${collaborative}）`)
      await page.evaluate(({ src, text, collaborative, scenario }) => window.editorFixture.mount(collaborative, {
        type: 'doc', content: [
          { type: 'paragraph', attrs: { diffId: 'caption-before' }, content: [{ type: 'text', text: '图片前正文' }] },
          ...(scenario === 'pasted' ? [] : [{
            type: 'image', attrs: { src, diffId: 'caption-image', width: 640, height: 240, align: 'center' },
            content: [{ type: 'imageCaption', ...(scenario === 'existing' ? { content: [{ type: 'text', text }] } : {}) }],
          }]),
          { type: 'paragraph', attrs: { diffId: 'caption-after' }, content: [{ type: 'text', text: '图片后正文' }] },
        ],
      }), { src, text, collaborative, scenario })

      if (scenario === 'pasted') {
        // 通过真实浏览器 HTML 粘贴建立图片 NodeView，再返回题注编辑。
        await page.evaluate(({ src, text }) => navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([`<figure data-requirement-image><img src="${src}" width="640" height="240"><figcaption><span data-image-caption-content>${text}</span></figcaption></figure>`], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]), { src, text })
        await page.locator('.tiptap > p').first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Control+v')
      }
      await expect(caption).toBeVisible()
      await expect.poll(() => page.locator('.requirement-image img').first().evaluate(image => image.complete && image.naturalWidth)).toBe(640)
      const paragraph = page.locator('.tiptap > p').last()
      if (scenario === 'empty-return') {
        await enterCaption()
        await paragraph.click()
        await page.keyboard.insertText('第一次离开')
      }
      if (scenario === 'typed' || scenario === 'empty-return') {
        await enterCaption()
        await page.keyboard.insertText(text)
      }
      await expect(content).toHaveText(text)
      await paragraph.click()
      await page.keyboard.insertText('正文追加')
      await enterCaption(text.length)
      await page.keyboard.insertText('再')
      const updatedText = `${text}再`
      await expect(content).toHaveText(updatedText)
      const before = await documentJson()

      // 拖选必须同时更新 DOM 和 ProseMirror，复制只包含被选中的局部文字。
      const selected = updatedText.slice(2, 6)
      await selectCaption(2, 6, selected)
      await page.keyboard.press('Control+c')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected)
      expect(await documentJson()).toEqual(before)

      // 正反向拖选后的替换、删除及撤销不能修改图片属性或相邻正文。
      for (const replacement of ['替换', '']) {
        await selectCaption(6, 2, selected)
        await page.evaluate(() => window.editorFixture.separateHistory())
        if (replacement) await page.keyboard.insertText(replacement)
        else await page.keyboard.press('Backspace')
        const expected = structuredClone(before)
        expected.content.find(node => node.type === 'image').content[0].content = [
          { type: 'text', text: updatedText.slice(0, 2) + replacement + updatedText.slice(6) },
        ]
        await expect.poll(documentJson).toEqual(expected)
        await page.keyboard.press('Control+z')
        await expect.poll(documentJson).toEqual(before)
        await page.keyboard.press('Control+y')
        await expect.poll(documentJson).toEqual(expected)
        await page.keyboard.press('Control+z')
        await expect.poll(documentJson).toEqual(before)
      }
      await enterCaption(updatedText.length)
      await page.keyboard.press('Shift+ArrowLeft')
      await expect.poll(() => page.evaluate(() => {
        const { selection } = window.editorFixture.editor().state
        return { from: selection.$from.parentOffset, to: selection.$to.parentOffset, text: window.getSelection()?.toString() }
      })).toEqual({ from: updatedText.length - 1, to: updatedText.length, text: '再' })
      if (collaborative) {
        await expect.poll(() => page.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson)).toEqual(before)
      }
    }
  }
  console.log('通过：普通/协作题注重新输入、真实 HTML 图片粘贴、点击落光标、双向鼠标拖选、局部复制/替换/删除、撤销/重做与键盘扩选。')
}
