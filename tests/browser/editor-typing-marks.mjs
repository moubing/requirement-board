import { expect } from '@playwright/test'

export async function verifyTypingMarks(page) {
  const content = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '已有格式', marks: [
      { type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }, { type: 'highlight' },
      { type: 'link', attrs: { href: 'https://example.com' } },
    ] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '普通文字' }] },
  ] }
  const pendingMarks = () => page.evaluate(() => window.editorFixture.editor().state.storedMarks?.map(mark => mark.type.name))

  for (const collaborative of [false, true]) {
    console.log(`验证停止格式继承快捷键（协作：${collaborative}）`)
    await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content })
    const before = await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection(3)
      editor.view.focus()
      return editor.getJSON()
    })
    await expect(page.getByLabel('输入格式状态', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '停止继承行内格式', exact: true })).toHaveCount(0)
    const toolbarBefore = await page.locator('.requirement-editor__toolbar').boundingBox()

    await page.keyboard.press('Control+Alt+\\')
    expect(await pendingMarks()).toEqual([])
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before)
    expect(await page.locator('.requirement-editor__toolbar').boundingBox()).toEqual(toolbarBefore)
    await page.keyboard.insertText('普通')
    await page.keyboard.insertText('输入')
    const typed = await page.evaluate(() => window.editorFixture.editor().getJSON())
    expect(typed.content[0]).toEqual({ ...before.content[0], content: [
      { ...before.content[0].content[0], text: '已有' },
      { type: 'text', text: '普通输入' },
      { ...before.content[0].content[0], text: '格式' },
    ] })
    await page.keyboard.press('Control+z')
    await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before)
    await page.keyboard.press('Control+y')
    await expect.poll(() => page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(typed)

    // 光标重回格式文字后重新继承，快捷键仍可再次清除全部输入格式。
    await page.evaluate(() => window.editorFixture.editor().commands.setTextSelection(2))
    expect(await page.evaluate(() => window.editorFixture.editor().isActive('bold'))).toBe(true)
    await page.keyboard.press('Control+Alt+\\')
    await expect(page.locator('.tiptap')).toBeFocused()
    expect(await pendingMarks()).toEqual([])
    await page.keyboard.insertText('快捷键')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[0].content[1])).toEqual({ type: 'text', text: '快捷键' })

    // 停止继承后仍能用单独的格式快捷键重新启用 marks。
    await page.evaluate(() => window.editorFixture.editor().commands.setTextSelection(2))
    await page.keyboard.press('Control+Alt+\\')
    expect(await pendingMarks()).toEqual([])
    await page.keyboard.press('Control+b')
    expect(await pendingMarks()).toEqual(['bold'])
    await page.keyboard.press('Control+i')
    expect(await pendingMarks()).toEqual(['bold', 'italic'])

    // 中文输入法原生组词、提交必须使用停止后的无格式状态。
    await page.keyboard.press('Control+Alt+\\')
    const cdp = await page.context().newCDPSession(page)
    try {
      await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 })
      await cdp.send('Input.insertText', { text: '中文' })
    } finally {
      await cdp.detach()
    }
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON().content[0].content[1])).toEqual({ type: 'text', text: '中文快捷键' })

    await page.evaluate(() => {
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection({ from: 1, to: 3 })
    })
    const selected = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await page.keyboard.press('Control+Alt+\\')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(selected)
  }
}
