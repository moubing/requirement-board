import { expect } from '@playwright/test'

const paragraph = (diffId, text) => ({ type: 'paragraph', attrs: { diffId }, ...(text ? { content: [{ type: 'text', text }] } : {}) })
const image = { type: 'image', attrs: { diffId: 'passive_image', src: '/uploads/passive-loading.svg', width: 120, height: 60, align: 'center' },
  content: [{ type: 'imageCaption', content: [{ type: 'text', text: '文末图片题注' }] }] }
const documentWith = (...nodes) => ({ type: 'doc', content: [paragraph('passive_intro', '仅阅读正文'), ...nodes] })
const samples = [
  documentWith(image),
  documentWith(image, paragraph('passive_empty')),
  documentWith(paragraph('passive_text', '文末段落')),
  { type: 'doc', content: [paragraph('passive_blank')] },
  documentWith({ type: 'heading', attrs: { diffId: 'passive_heading', level: 2 }, content: [{ type: 'text', text: '文末标题' }] }),
  ...['bulletList', 'orderedList'].map(type => documentWith({ type, attrs: { diffId: `passive_${type}` }, content: [
    { type: 'listItem', attrs: { diffId: 'passive_item' }, content: [paragraph('passive_item_text', '文末列表项')] },
  ] })),
  documentWith({ type: 'table', attrs: { diffId: 'passive_table' }, content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [paragraph('passive_cell', '文末单元格')] },
  ] }] }),
  documentWith({ type: 'codeBlock', attrs: { diffId: 'passive_code' }, content: [{ type: 'text', text: 'const value = 1' }] }),
  documentWith({ type: 'blockquote', attrs: { diffId: 'passive_quote' }, content: [paragraph('passive_quote_text', '文末引用')] }),
  documentWith({ type: 'callout', attrs: { diffId: 'passive_callout', tone: 'note' }, content: [{ type: 'text', text: '文末提示' }] }),
  documentWith({ type: 'horizontalRule', attrs: { diffId: 'passive_rule' } }),
]

async function expectUnmodified(page, content, collaborative) {
  expect(await page.evaluate(content => window.editorFixture.compareContent(content), content)).toMatchObject({
    modified: false, counts: { inserted: 0, deleted: 0, modified: 0 },
  })
  const current = await page.evaluate(() => window.editorFixture.editor().getJSON())
  const baseline = await page.evaluate(content => window.editorFixture.editor().schema.nodeFromJSON(content).toJSON(), content)
  expect(current, '写入时已规范化的正文、空段和块 ID 保持不变').toEqual(baseline)
  if (collaborative) {
    expect(await page.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson)).toEqual(current)
    expect(await page.evaluate(() => window.editorFixture.localUpdates), '阅读不产生可入队的本地 Yjs 更新').toBe(0)
  }
  expect(await page.evaluate(() => window.editorFixture.editor().can().undo())).toBe(false)
}

export async function verifyPassiveLoading(page) {
  await page.context().route('**/uploads/passive-loading.svg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#ccddee"/></svg>',
  }))
  // 模拟新写入路径：保存版本和共同正文之前就完成规范化，比较器不忽略尾段。
  const preparedSamples = await page.evaluate(samples => samples.map(content => window.editorFixture.normalizeContent(content)), samples)
  for (const collaborative of [true, false]) {
    for (const disabled of [false, true]) {
      for (const content of preparedSamples) {
        await page.evaluate(({ collaborative, content, disabled }) => window.editorFixture.mount(collaborative, content, { disabled }), { collaborative, content, disabled })
        await expectUnmodified(page, content, collaborative)
        await page.locator('.tiptap p').first().click()
        await page.evaluate(() => window.editorFixture.setActive(false))
        await page.evaluate(() => { window.editorFixture.setActive(true); window.editorFixture.setDisabled(true) })
        await page.evaluate(() => window.editorFixture.setDisabled(false))
        await expectUnmodified(page, content, collaborative)
      }
    }
  }
  console.log('通过：12 种文末结构在规范化后加载/恢复，保留可输入尾段且不新增版本差异或本地编辑。')

  // 远端 AI 更新沿原 Yjs 历史应用，接收者不得自动补段并产生本地回写。
  await page.evaluate(() => window.editorFixture.mount(true, { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'remote_initial' } }] }))
  for (const content of preparedSamples) {
    await page.evaluate(content => window.editorFixture.applySuggestion(content), content)
    await expectUnmodified(page, content, true)
  }

  const content = preparedSamples[0]
  await page.evaluate(content => window.editorFixture.mount(true, content), content)
  expect(await page.evaluate(legacy => window.editorFixture.compareContent(legacy), samples[0])).toMatchObject({
    modified: true, counts: { inserted: 1, deleted: 0, modified: 0 },
  })
  const state = await page.evaluate(() => window.editorFixture.collaborationState())
  const peer = await page.context().newPage()
  try {
    await peer.goto(page.url())
    await peer.waitForFunction(() => Boolean(window.editorFixture))
    await peer.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content, state })
    await expectUnmodified(peer, content, true)
    await page.reload()
    await page.waitForFunction(() => Boolean(window.editorFixture))
    await page.evaluate(({ content, state }) => window.editorFixture.mount(true, content, { state }), { content, state })
    await expectUnmodified(page, content, true)
    await page.evaluate(state => window.editorFixture.receiveState(state), await peer.evaluate(() => window.editorFixture.collaborationState()))
    await expectUnmodified(page, content, true)

    // 题注 Enter 复用已有尾段；输入、撤销、重做和另一页合并保留其 ID。
    const before = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await page.bringToFront()
    await page.locator('.requirement-image__caption').click()
    await expect(page.locator('.tiptap')).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.editorFixture.editor().state.selection.$from.parent.type.name)).toBe('imageCaption')
    await page.keyboard.press('Enter')
    const inserted = await page.evaluate(() => window.editorFixture.editor().getJSON())
    expect(inserted.content.map(node => node.type)).toEqual(['paragraph', 'image', 'paragraph'])
    expect(inserted.content.at(-1).attrs.diffId).toMatch(/^para_/)
    expect(inserted).toEqual(before)
    await expectUnmodified(page, content, true)
    await page.evaluate(() => window.editorFixture.separateHistory())
    await page.keyboard.insertText('图片之后继续输入')
    const typed = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(inserted)
    expect(await page.evaluate(() => window.editorFixture.editor().can().undo())).toBe(false)
    await page.keyboard.press('Control+Shift+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(typed)
    await peer.evaluate(state => window.editorFixture.receiveState(state), await page.evaluate(() => window.editorFixture.collaborationState()))
    expect(await peer.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson)).toEqual(typed)
    expect(await peer.evaluate(() => window.editorFixture.localUpdates)).toBe(0)

    // 主动增加的额外空段仍计入差异，并可撤销；普通文字末尾不强制再补空段。
    await page.bringToFront()
    await page.evaluate(() => {
      window.editorFixture.separateHistory()
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection(editor.state.doc.content.size - 1)
      editor.view.focus()
    })
    await page.keyboard.press('Enter')
    expect(await page.evaluate(typed => window.editorFixture.compareContent(typed), typed)).toMatchObject({ modified: true, counts: { inserted: 1 } })
    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(typed)
  } finally { await peer.close() }
  for (const type of ['table', 'codeBlock']) {
    const content = preparedSamples[samples.findIndex(doc => doc.content.at(-1).type === type)]
    await page.evaluate(content => window.editorFixture.mount(true, content), content)
    const before = await page.evaluate(() => window.editorFixture.editor().getJSON())
    await page.locator('.tiptap > p').last().click()
    await page.keyboard.insertText('结构之后继续输入')
    expect(await page.evaluate(() => window.editorFixture.editor().state.doc.lastChild.textContent)).toBe('结构之后继续输入')
    expect(await page.evaluate(content => window.editorFixture.compareContent(content), content)).toMatchObject({ modified: true })
    await page.keyboard.press('Control+z')
    expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(before)
  }
  console.log('通过：远端正文接收、二进制刷新/双页合并保持尾段；图片、表格、代码后继续输入、额外空段及撤销/重做保留真实差异和稳定 ID。')
}
