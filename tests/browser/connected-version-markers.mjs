import { expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const p = (id, text = id) => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text }] })
const item = (id, text) => ({ type: 'listItem', attrs: { diffId: id }, content: [p(`${id}-text`, text)] })
const modifiedIds = ['join-a', 'join-b', 'join-c', 'join-d', 'join-e']
const insertedIds = ['new-a', 'new-b', 'new-rule', 'new-code', 'new-empty', 'ordered-a', 'ordered-b', 'bullet-a', 'bullet-b']
const baseline = { type: 'doc', content: [p('start', '正文版本标记'), ...modifiedIds.slice(0, 3).map(id => p(id, `修改前：${id}`)),
  p('removed', '已经删除的旧说明'), ...modifiedIds.slice(3).map(id => p(id, `修改前：${id}`)), p('stable', '这一段保持不变'), p('after', '这一段也保持不变'), p('end', '正文结尾')] }
const target = { type: 'doc', content: [p('start', '正文版本标记'), ...modifiedIds.map(id => p(id, `修改后：${id}`)),
  p('different', '此处为新增内容'), p('stable', '这一段保持不变'), p('new-a', '连续新增第一段'), p('new-b', '连续新增第二段'),
  { type: 'horizontalRule', attrs: { diffId: 'new-rule' } },
  { type: 'codeBlock', attrs: { diffId: 'new-code' }, content: [{ type: 'text', text: 'const a = 1\nconst b = 2\na + b' }] },
  { type: 'paragraph', attrs: { diffId: 'new-empty' } },
  { type: 'orderedList', attrs: { diffId: 'ordered', start: 1 }, content: [item('ordered-a', '有序列表第一项'), item('ordered-b', '有序列表第二项')] },
  { type: 'bulletList', attrs: { diffId: 'bullet' }, content: [item('bullet-a', '无序列表第一项'), item('bullet-b', '无序列表第二项')] },
  p('after', '这一段也保持不变'), p('separate', '独立的新增段落'), p('end', '正文结尾')] }

// 只检查 DOM 坐标相接会漏掉独立图层在小数像素处的浅色缝；直接检查截图中心轴的像素。
async function verifyStrokePixels(page, ids) {
  const box = await page.evaluate(ids => {
    const firstElement = document.querySelector(`[data-version-marker="inserted:${ids[0]}"] i`)
    const first = firstElement.getBoundingClientRect()
    const last = document.querySelector(`[data-version-marker="inserted:${ids.at(-1)}"] i`).getBoundingClientRect()
    const viewport = firstElement.closest('.bing-scrollbar__viewport').getBoundingClientRect()
    // 大字号下末项可能落到正文裁剪区外，只采样实际可见的线段。
    return { x: first.x + first.width / 2, top: Math.max(first.top, viewport.top) + 3,
      bottom: Math.min(last.bottom, viewport.bottom, innerHeight) - 3 }
  }, ids)
  const screenshot = await page.screenshot()
  const variation = await page.evaluate(async ({ png, box }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const scale = image.width / window.innerWidth
    const pixels = context.getImageData(Math.floor(box.x * scale), Math.ceil(box.top * scale), 1, Math.floor((box.bottom - box.top) * scale)).data
    const ranges = [0, 1, 2].map(channel => {
      const values = Array.from({ length: pixels.length / 4 }, (_, i) => pixels[i * 4 + channel])
      return Math.max(...values) - Math.min(...values)
    })
    return Math.max(...ranges)
  }, { png: screenshot.toString('base64'), box })
  if (variation > 2 && process.env.BROWSER_TEST_ARTIFACT_DIR) {
    await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
    await writeFile(join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'version-stroke-failure.png'), screenshot)
  }
  expect(variation, `整条连续竖线的中心轴没有浅色接缝或重叠深色条 ${JSON.stringify(box)}`).toBeLessThanOrEqual(2)
}

export async function verifyConnectedVersionMarkers(page, url, screenshot) {
  await page.goto(url)
  const editor = page.locator('.tiptap')
  const marker = id => page.locator(`[data-version-marker="${id}"]`)
  const block = id => editor.locator(`[data-diff-id="${id}"]`)
  const card = page.getByRole('dialog', { name: '版本修改预览' })
  const highlight = page.locator('.version-markers__content-highlight')
  const viewport = page.getByRole('region', { name: '文档正文', exact: true })
  await expect(editor).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(({ baseline, target }) => {
    window.workspaceFixture.preferences.resetReading()
    window.workspaceFixture.setComparison(baseline, target)
  }, { baseline, target })
  const snapshot = await editor.evaluate(element => element.editor.getJSON())

  async function hoverBlock(status, id) {
    await marker(`${status}:${id}`).hover()
    await expect(highlight).toHaveCount(1)
    await expect(highlight).toHaveAttribute('data-version-highlight', `${status}:${id}`)
    await expect.poll(async () => {
      const content = await block(id).boundingBox(), tint = await highlight.boundingBox()
      const contentHeight = id === 'new-rule' ? (await block('new-empty').boundingBox()).height : content?.height
      return tint && content && Math.abs(tint.x - (content.x - 4)) < 1 && Math.abs(tint.y + tint.height / 2 - (content.y + content.height / 2)) < 1
        && Math.abs(tint.width - (content.width + 8)) < 1 && Math.abs(tint.height - Math.max(8, contentHeight + 6)) < 1
    }, { message: '悬停底色覆盖当前块；分隔线与一行普通正文等高，并围绕横线居中' }).toBe(true)
    await expect(highlight).toHaveCSS('pointer-events', 'none')
    await expect(highlight).toHaveCSS('box-shadow', 'none')
    await expect(highlight).toHaveCSS('border-width', '0px')
    await expect(marker(`${status}:${id}`).locator('i')).toHaveCSS('opacity', '1')
    await expect(marker(`${status}:${id}`).locator('i')).toHaveCSS('width', '5px')
  }

  // 测实际绘制线段，覆盖段落间距、分隔线、代码、空段落及跨列表容器的接缝。
  async function connected(status, ids) {
    await expect.poll(() => page.evaluate(({ status, ids }) => {
      const boxes = ids.map(id => document.querySelector(`[data-version-marker="${status}:${id}"] i`)?.getBoundingClientRect())
      if (boxes.some(box => !box)) return false
      const first = document.querySelector(`.tiptap [data-diff-id="${ids[0]}"]`).getBoundingClientRect()
      const last = document.querySelector(`.tiptap [data-diff-id="${ids.at(-1)}"]`).getBoundingClientRect()
      return Math.abs(boxes[0].top - first.top) < 1 && Math.abs(boxes.at(-1).bottom - last.bottom) < 1
        && boxes.every((box, index) => !index || Math.abs(box.top - boxes[index - 1].bottom) < 1)
    }, { status, ids }), { message: `${status} 连线覆盖整组且接缝无空隙` }).toBe(true)
    for (const [index, id] of ids.entries()) {
      await expect(marker(`${status}:${id}`).locator('i')).toHaveCSS('border-top-left-radius', index ? '0px' : '2px')
      await expect(marker(`${status}:${id}`).locator('i')).toHaveCSS('border-bottom-left-radius', index < ids.length - 1 ? '0px' : '2px')
    }
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.bingTheme = theme, theme)
    for (const width of [1440, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 1440 })
      await connected('modified', modifiedIds.slice(0, 3))
      await connected('modified', modifiedIds.slice(3))
      await connected('inserted', insertedIds)
      for (const id of ['inserted:different', 'inserted:separate', 'deleted:removed']) {
        await expect(marker(id)).not.toHaveClass(/is-joined/)
      }
      await expect(page.locator('[data-version-stroke]')).toHaveCount(6)
      if (screenshot && width === 1440) await screenshot(`connected-version-markers-${theme}`)
      if (width === 1440 || width === 390) {
        await hoverBlock('inserted', 'new-code')
        await expect(highlight).toHaveCSS('animation-name', 'none')
        if (screenshot) await screenshot(`version-marker-hover-${theme}-${width}`)
        await hoverBlock('inserted', 'new-rule')
        if (screenshot) await screenshot(`version-marker-divider-${theme}-${width}`)
        await page.mouse.move(0, 0)
        await expect(highlight).toHaveCount(0)
      }
    }
  }
  expect(await editor.evaluate(element => element.editor.getJSON())).toEqual(snapshot)

  await page.setViewportSize({ width: 1440, height: 1440 })
  await connected('modified', modifiedIds.slice(0, 3))
  await page.mouse.move(0, 0)
  const cdp = await page.context().newCDPSession(page)
  try {
    for (const scale of [1, 1.25, 1.5]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1800, deviceScaleFactor: scale, mobile: false })
      for (const fontSize of [16, 19, 20]) {
        await page.evaluate(fontSize => {
          const p = window.workspaceFixture.preferences
          p.setFontSize('paragraph', fontSize); p.setLineHeight(fontSize === 20 ? 2.2 : 1.7)
        }, fontSize)
        await connected('inserted', insertedIds)
        await verifyStrokePixels(page, insertedIds)
        await hoverBlock('inserted', 'new-rule')
        await page.mouse.move(0, 0)
        await expect(highlight).toHaveCount(0)
      }
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach()
    await page.evaluate(() => window.workspaceFixture.preferences.resetReading())
  }
  // 鼠标、键盘与动态效果只影响外部浮层，正文 JSON、选区和尺寸保持不变。
  const beforeHover = await editor.evaluate(element => ({ json: element.editor.getJSON(), selection: element.editor.state.selection.toJSON(), width: element.getBoundingClientRect().width }))
  for (const [status, id] of [['inserted', 'new-b'], ['inserted', 'new-rule'], ['inserted', 'new-empty'], ['inserted', 'ordered-b'], ['modified', 'join-b']]) await hoverBlock(status, id)
  await page.mouse.move(0, 0)
  await expect(highlight).toHaveCount(0)
  expect(await editor.evaluate(element => ({ json: element.editor.getJSON(), selection: element.editor.state.selection.toJSON(), width: element.getBoundingClientRect().width }))).toEqual(beforeHover)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await hoverBlock('inserted', 'new-code')
  await expect(highlight).toHaveCSS('animation-name', /version-block-emphasis/)
  await expect.poll(() => highlight.evaluate(element => Number(getComputedStyle(element).opacity)), { intervals: [16] }).toBeGreaterThan(.8)
  await expect(highlight).toHaveCSS('opacity', '0.65')
  await page.mouse.move(0, 0)
  await expect(highlight).toHaveCount(0)
  await marker('modified:join-b').focus()
  await expect(highlight).toHaveAttribute('data-version-highlight', 'modified:join-b')
  await page.keyboard.press('Enter')
  await expect(card.locator('.version-change-card__pair')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await expect(highlight).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await hoverBlock('inserted', 'new-code')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(highlight).toHaveCount(0)
  await expect(page.locator('[data-version-stroke]')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
  await connected('inserted', insertedIds)
  await expect(marker('modified:join-b')).toHaveAttribute('aria-disabled', 'false')
  // 点击段间空隙靠近下一块的一侧，仍只打开该块的 Diff，恢复后连线在该块处断开。
  const first = await block('join-a').boundingBox(), second = await block('join-b').boundingBox()
  const hit = await marker('modified:join-b').boundingBox()
  await page.mouse.click(hit.x + hit.width / 2, (first.y + first.height + second.y * 3) / 4)
  await expect(card).toContainText('修改前：join-b')
  await expect(card.locator('.version-change-card__pair')).toHaveCount(1)
  await expect(card.locator('.diff-block')).toHaveCount(2)
  await card.getByRole('button', { name: '恢复为 v3' }).click()
  await expect(block('join-b')).toHaveText('修改前：join-b')
  for (const id of ['join-a', 'join-c']) {
    await expect(block(id)).toHaveText(`修改后：${id}`)
    await expect(marker(`modified:${id}`)).not.toHaveClass(/is-joined/)
  }
  await page.keyboard.press('Control+z')
  await connected('modified', modifiedIds.slice(0, 3))
  await marker('inserted:ordered-b').click()
  await card.getByRole('button', { name: '恢复为 v3' }).click()
  await expect(block('ordered-b')).toHaveCount(0)
  await expect(block('ordered-a')).toHaveText('有序列表第一项')
  await connected('inserted', insertedIds.filter(id => id !== 'ordered-b'))
  await page.keyboard.press('Control+z')
  await connected('inserted', insertedIds)

  // 长修改区间只渲染可见标记，视口两端不能重新出现断线；点击始终只渲染一块差异。
  const longBase = { type: 'doc', content: Array.from({ length: 300 }, (_, index) => p(`long-join-${index}`, `第 ${index} 段原文`)) }
  const longTarget = { type: 'doc', content: longBase.content.map((node, index) => p(node.attrs.diffId, `第 ${index} 段更新后`)) }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(({ baseline, target }) => window.workspaceFixture.setComparison(baseline, target), { baseline: longBase, target: longTarget })
  await expect(marker('modified:long-join-0')).toBeVisible()
  for (const resized of [false, true]) {
    if (resized) await page.evaluate(() => {
      const p = window.workspaceFixture.preferences
      p.setFontSize('paragraph', 22); p.setLineHeight(2.2); p.setDocumentWidth(600)
    })
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight / 2 })
    await expect.poll(() => viewport.evaluate(element => {
      const boxes = [...document.querySelectorAll('[data-version-marker] i')].map(symbol => symbol.getBoundingClientRect())
      const clip = element.getBoundingClientRect()
      return boxes.length > 1 && boxes.length < 40 && boxes[0].top <= clip.top && boxes.at(-1).bottom >= clip.bottom
        && boxes.every((box, index) => !index || Math.abs(box.top - boxes[index - 1].bottom) < 1)
    }), { message: '300 段连续修改滚动与改排版后，仅渲染可见线段并覆盖视口' }).toBe(true)
  }
  const middle = page.locator('[data-version-marker]').nth(3)
  await middle.click()
  await expect(card.locator('.version-change-card__pair')).toHaveCount(1)
  await expect(card.locator('.diff-block')).toHaveCount(2)
  expect((await card.boundingBox()).height).toBeLessThanOrEqual(360)
  await page.keyboard.press('Escape')
  await middle.hover()
  await expect(highlight).toHaveCount(1)
  const hoveredBeforeScroll = await middle.getAttribute('data-version-marker')
  await viewport.evaluate(element => { element.scrollTop += element.clientHeight })
  await expect(page.locator(`[data-version-highlight="${hoveredBeforeScroll}"]`)).toHaveCount(0)
  // 滚动后另一条标记可能进入静止的指针下方；离开页边后也不能残留该新块的高亮。
  await page.mouse.move(0, 0)
  await expect(highlight).toHaveCount(0)
  expect(await editor.evaluate(element => element.editor.getJSON().content.map(node => node.content[0].text))).toEqual(longTarget.content.map(node => node.content[0].text))
  console.log('通过：连续笔画及多种像素密度/字号的截图像素、跨节点连接与中断、亮暗四种宽度、悬停/键盘正文强调与动效降级、间距点击、单块恢复/撤销、300 段滚动裁剪及单块 Diff。')
}
