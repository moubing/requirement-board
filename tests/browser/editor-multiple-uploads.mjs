import { expect } from '@playwright/test'

export async function verifyMultipleImageUploads(page) {
  const requests = []
  const uploadRoute = '**/api/assets/upload?*'
  const imageRoute = '**/uploads/multiple-upload-*.png'
  await page.route(uploadRoute, route => { requests.push(route) })
  const bytes = await page.evaluate(async () => {
    window.multipleUploadsOriginalFetch = window.$fetch
    window.$fetch = async (url, options) => {
      const response = await fetch(url, options)
      if (!response.ok) throw new Error('上传失败')
      return response.json()
    }
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 100
    canvas.getContext('2d').fillRect(0, 0, 200, 100)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.route(imageRoute, route => route.fulfill({ contentType: 'image/png', body: Buffer.from(bytes, 'base64') }))
  const placeholders = page.locator('.requirement-image-upload')
  const state = (uploading, failed) => expect.poll(() => page.evaluate(() => window.editorFixture.uploadState)).toEqual({ uploading, failed })
  const checkpoint = count => expect.poll(() => page.evaluate(() => window.editorFixture.uploadCheckpoint.length)).toBe(count)
  const images = () => page.evaluate(() => {
    const result = []
    window.editorFixture.editor().state.doc.descendants(node => {
      if (node.type.name === 'image') result.push({ src: node.attrs.src, id: node.attrs.diffId })
    })
    return result
  })
  const finish = async (index, name) => {
    await expect.poll(() => requests.length).toBeGreaterThan(index)
    await requests[index].fulfill({ json: { url: `/uploads/multiple-upload-${name}.png`, fileName: 'image.png' } })
  }
  const paste = async count => {
    for (let index = 0; index < count; index++) {
      await page.keyboard.press('Control+v')
      await expect(placeholders).toHaveCount(index + 1)
    }
    await state(count, 0)
    await checkpoint(count)
    expect(await images()).toHaveLength(0)
  }
  const mount = async (collaborative, location) => {
    requests.length = 0
    await page.evaluate(async ({ collaborative, location }) => {
      await window.editorFixture.mount(collaborative, { type: 'doc', content: [
        { type: 'paragraph', attrs: { diffId: 'multiple-upload-text' },
          content: location === 'empty' ? [] : [{ type: 'text', text: '正在输入正文' }] },
      ] })
      const editor = window.editorFixture.editor()
      editor.commands.setTextSelection(location === 'empty' ? 1 : location === 'middle' ? 3 : 7)
      editor.view.focus()
    }, { collaborative, location })
  }
  const assertFinished = async (collaborative, expected) => {
    await state(0, 0)
    await checkpoint(0)
    await expect(placeholders).toHaveCount(0)
    const result = await images()
    expect(result.map(image => image.src)).toEqual(expected.map(name => `/uploads/multiple-upload-${name}.png`))
    expect(new Set(result.map(image => image.id)).size).toBe(expected.length)
    if (collaborative) {
      expect(await page.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson))
        .toEqual(await page.evaluate(() => window.editorFixture.editor().getJSON()))
    }
  }
  const remoteEdit = async () => {
    await page.evaluate(() => {
      const content = window.editorFixture.editor().getJSON()
      content.content.unshift({ type: 'paragraph', attrs: { diffId: 'remote-before-uploads' }, content: [{ type: 'text', text: '远端新增段落' }] })
      window.editorFixture.applySuggestion(content)
    })
    await expect(page.locator('[data-diff-id="remote-before-uploads"]')).toHaveText('远端新增段落')
  }
  try {
    for (const collaborative of [false, true]) {
      for (const { location, count, typing } of [
        { location: 'empty', count: 2, typing: false },
        { location: 'end', count: 2, typing: false },
        { location: 'empty', count: 3, typing: true },
        { location: 'middle', count: 3, typing: true },
        { location: 'end', count: 3, typing: true },
      ]) {
        await mount(collaborative, location)
        await paste(count)
        // 同一张剪贴板图片连续粘贴，接口逐个放行，另覆盖上传期间继续输入。
        if (typing) await page.keyboard.insertText('继续')
        for (let index = 0; index < count; index++) {
          await finish(index, `${location}-${index}`)
          await state(count - 1 - index, 0)
          await checkpoint(count - 1 - index)
          await expect(placeholders).toHaveCount(count - 1 - index)
          expect(await images()).toHaveLength(index + 1)
          if (collaborative && index === 0) {
            await remoteEdit()
            await expect(placeholders).toHaveCount(count - 1)
          }
        }
        await assertFinished(collaborative, Array.from({ length: count }, (_, index) => `${location}-${index}`))
        expect(await page.evaluate(() => window.editorFixture.editor().state.doc.textContent.replace('远端新增段落', '')))
          .toBe(!typing ? location === 'empty' ? '' : '正在输入正文' : location === 'empty' ? '继续' : location === 'middle' ? '正在继续输入正文' : '正在输入正文继续')
        console.log(`通过：连续粘贴 ${count} 图（${location}，继续输入：${typing}，协作：${collaborative}）。`)
      }

      await mount(collaborative, 'end')
      await paste(3)
      await expect.poll(() => requests.length).toBe(1)
      await requests[0].fulfill({ status: 503, json: { message: '模拟上传失败' } })
      await state(2, 1)
      await finish(1, 'retry-second')
      await state(1, 1)
      await finish(2, 'retry-third')
      await state(0, 1)
      await checkpoint(1)
      if (collaborative) await remoteEdit()
      await placeholders.getByRole('button', { name: '重试', exact: true }).click()
      await finish(3, 'retry-first')
      await assertFinished(collaborative, ['retry-first', 'retry-second', 'retry-third'])
      console.log(`通过：首图失败后重试保留粘贴顺序（协作：${collaborative}）。`)

      await mount(collaborative, 'empty')
      await paste(3)
      await placeholders.nth(1).getByRole('button', { name: '取消', exact: true }).click()
      await state(2, 0)
      await checkpoint(2)
      await finish(0, 'cancel-first')
      await finish(1, 'cancel-third')
      await assertFinished(collaborative, ['cancel-first', 'cancel-third'])
      expect(requests).toHaveLength(2)
      console.log(`通过：取消排队图片不会丢失其他任务（协作：${collaborative}）。`)

      await mount(collaborative, 'end')
      await paste(2)
      await page.evaluate(() => window.editorFixture.rejectNextUploadInsertion())
      await finish(0, 'blocked-first')
      await state(1, 1)
      await expect(placeholders.first()).toContainText('图片已上传，但无法插入原位置')
      await finish(1, 'blocked-second')
      await state(0, 1)
      await checkpoint(1)
      await placeholders.getByRole('button', { name: '重试', exact: true }).click()
      await assertFinished(collaborative, ['blocked-first', 'blocked-second'])
      expect(requests).toHaveLength(2) // 使用已上传的 asset 重试插入，不重复上传。
      console.log(`通过：插入被拒绝时保留失败任务，重试复用上传结果（协作：${collaborative}）。`)
    }
  } finally {
    await page.unroute(uploadRoute)
    await page.unroute(imageRoute)
    await page.evaluate(() => {
      if (window.multipleUploadsOriginalFetch) window.$fetch = window.multipleUploadsOriginalFetch
      else delete window.$fetch
      delete window.multipleUploadsOriginalFetch
    })
  }
}
