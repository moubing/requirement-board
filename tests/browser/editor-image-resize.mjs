import { expect } from '@playwright/test'

export async function verifyImageResize(page) {
  const shapes = [{ width: 500, height: 250 }, { width: 600, height: 100 },
    { width: 250, height: 500 }, { width: 300, height: 300 }]
  const originalViewport = page.viewportSize()
  await page.setViewportSize({ width: 1440, height: 1400 })
  const imageNode = () => page.evaluate(() => window.editorFixture.editor().getJSON().content.find(node => node.type === 'image'))
  try {
    for (const shape of shapes) {
      const src = `/uploads/resize-${shape.width}-${shape.height}.svg`
      await page.route(`**${src}`, route => route.fulfill({ contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${shape.width}" height="${shape.height}"><rect width="100%" height="100%" fill="#396fa5"/></svg>` }))
      for (const collaborative of [false, true]) {
        for (const align of ['left', 'center', 'right']) {
          await page.evaluate(({ collaborative, shape, src, align }) => window.editorFixture.mount(collaborative, {
            type: 'doc', content: [
              { type: 'paragraph', attrs: { diffId: 'resize-before' }, content: [{ type: 'text', text: '图片缩放回归' }] },
              { type: 'image', attrs: { ...shape, src, align, diffId: 'resize-image' },
                content: [{ type: 'imageCaption', content: [{ type: 'text', text: '保留题注' }] }] },
              { type: 'paragraph', attrs: { diffId: 'resize-after' } },
            ],
          }), { collaborative, shape, src, align })
          const image = page.locator('.requirement-image img')
          await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth)).toBe(shape.width)
          await page.locator('.requirement-image').hover()
          const panel = page.getByRole('group', { name: '调整图片尺寸', exact: true })
          const initialPanel = await panel.boundingBox()
          const initialImage = await image.boundingBox()
          const inset = { width: initialPanel.width - initialImage.width, height: initialPanel.height - initialImage.height }
          const direction = align === 'right' ? 'bottom-left' : 'bottom-right'
          const handle = panel.locator(`.bing-resizable__handle--${direction}`)
          await handle.scrollIntoViewIfNeeded()
          const box = await handle.boundingBox()
          const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          const xSign = align === 'right' ? -1 : 1
          await page.mouse.move(origin.x, origin.y)
          await page.mouse.down()
          let finalSize
          for (const [x, y] of [[100, 99], [100, 100], [100, 101], [100, 102], [100, 100],
            [40, -40], [40, -41], [40, -39], [40, -40]]) {
            await page.mouse.move(origin.x + x * xSign, origin.y + y)
            await expect(panel).toHaveClass(/is-resizing/)
            const current = await panel.boundingBox()
            const displayedImage = await image.boundingBox()
            expect(displayedImage.width).toBeCloseTo(current.width - inset.width, 1)
            expect(displayedImage.height).toBeCloseTo(current.height - inset.height, 1)
            expect(current.width / current.height).toBeCloseTo(shape.width / shape.height, 2)
            if (finalSize && Math.abs(y - finalSize.y) <= 2) {
              expect(Math.abs(current.width - finalSize.width), `${shape.width}×${shape.height} ${align} 协作=${collaborative}`).toBeLessThanOrEqual(2.1)
              expect(Math.abs(current.height - finalSize.height)).toBeLessThanOrEqual(2.1)
            }
            finalSize = { ...current, y }
          }
          await page.mouse.up()
          await expect(panel).not.toHaveClass(/is-resizing/)
          const saved = await imageNode()
          expect(saved.attrs.width).toBe(Math.round(finalSize.width))
          expect(saved.attrs.height).toBe(Math.round(finalSize.height))
          expect(saved.attrs).toMatchObject({ diffId: 'resize-image', align, src })
          expect(saved.content[0].content[0].text).toBe('保留题注')
          const rendered = await panel.boundingBox()
          expect(rendered.width).toBeCloseTo(saved.attrs.width, 1)
          expect(rendered.height).toBeCloseTo(saved.attrs.height, 1)
          if (collaborative) {
            const shared = await page.evaluate(() => window.editorFixture.collaborationSnapshot().contentJson.content.find(node => node.type === 'image'))
            expect(shared).toEqual(saved)
          }
          // 使用保存下来的 JSON 重新挂载，检查尺寸不会在重新加载时回跳。
          const content = await page.evaluate(() => window.editorFixture.editor().getJSON())
          await page.evaluate(({ collaborative, content }) => window.editorFixture.mount(collaborative, content), { collaborative, content })
          await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth)).toBe(shape.width)
          expect((await imageNode()).attrs).toEqual(saved.attrs)
          if (shape.width === 500 && align === 'center') {
            await page.getByRole('button', { name: '预览图片', exact: true }).click()
            const preview = page.getByRole('dialog', { name: '文档图片预览', exact: true })
            await expect(preview).toBeVisible()
            await expect(preview.locator('img').first()).toHaveAttribute('src', src)
            await page.getByRole('button', { name: '关闭预览', exact: true }).click()
            await expect(preview).toHaveCount(0)
            expect(await imageNode()).toEqual(saved)
          }
        }
      }
      await page.unroute(`**${src}`)
    }
  } finally {
    await page.mouse.up()
    await page.setViewportSize(originalViewport)
  }
  console.log('通过：四种图片比例 × 三种对齐 × 普通/协作编辑，角手柄跨轴与反向拖动连续，JSON/Yjs 尺寸、题注、ID 和重新加载一致。')
}
