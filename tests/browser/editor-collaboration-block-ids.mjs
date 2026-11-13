import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

export async function verifyCollaborativeBlockIds(page) {
  const content = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2, diffId: 'heading_read_more' }, content: [{ type: 'text', text: '继续阅读' }] },
    { type: 'bulletList', attrs: { diffId: 'list_read_more' }, content: [
      { type: 'listItem', attrs: { diffId: 'item_manual' }, content: [
        { type: 'paragraph', attrs: { diffId: 'para_manual' }, content: [{ type: 'text', text: '使用手册 01｜快速入门' }] },
      ] },
    ] },
  ] }

  for (const live of [false, true]) {
    console.log(`验证协作块标识（已打开页面接收建议：${live}）`)
    if (live) {
      await page.evaluate(() => window.editorFixture.mount(true, {
        type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'para_initial' } }],
      }))
      await page.evaluate(candidate => window.editorFixture.applySuggestion(candidate), content)
    } else {
      await page.evaluate(candidate => window.editorFixture.mount(true, candidate), content)
    }

    const editorContent = await page.evaluate(() => window.editorFixture.editor().getJSON())
    expect(editorContent.content.map(node => node.type)).toEqual(['heading', 'bulletList', 'paragraph'])
    expect(editorContent.content.at(-1).attrs.diffId).toMatch(/^para_/)

    // 仅点击正文再失焦，不输入文字；读取实际 Yjs 状态并执行保存端相同的 schema 校验。
    await page.locator('.tiptap h2').click()
    await page.locator('body').click({ position: { x: 2, y: 2 } })
    const snapshot = await page.evaluate(() => window.editorFixture.collaborationSnapshot())
    expect(snapshot.contentJson).toEqual(editorContent)
    expect(await page.evaluate(() => window.editorFixture.localUpdates)).toBe(0)
    expect(await page.evaluate(() => window.editorFixture.editor().can().undo())).toBe(false)
  }

  // 使用同一篇手册复现独立 Yjs 历史合并，逐帧检查首屏，而不只看动画结束后的截图。
  console.log('验证重复协作块不会让首屏正文短暂移出视口')
  const manual = JSON.parse(await readFile(new URL('../../server/db/seeds/07-accounts.json', import.meta.url), 'utf8'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    await page.evaluate(content => window.editorFixture.mount(true, content), manual.contentJson)
    await page.evaluate(() => document.fonts.ready)
    const positions = await page.evaluate(async () => {
      const editor = window.editorFixture.editor()
      const top = () => editor.view.dom.children[0].getBoundingClientRect().top
      const before = top()
      window.editorFixture.mergeIndependentHistory()
      const samples = []
      for (let frame = 0; frame < 20; frame++) {
        await new Promise(requestAnimationFrame)
        samples.push(top())
      }
      return { before, samples, blocks: editor.state.doc.childCount }
    })
    expect(positions.blocks).toBe(manual.contentJson.content.length * 2)
    expect(positions.samples.every(top => Math.abs(top - positions.before) < 2)).toBe(true)
    expect(await page.locator('style[data-document-layout-motion-style]').count()).toBe(0)
  } finally {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  }
}
