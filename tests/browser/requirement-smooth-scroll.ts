import { expect, type BrowserContext, type Page } from '@playwright/test'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'

/** 按鼠标档位构造滚轮输入，并检查输入结束后仍有连续位移。 */
async function sampleWheel(page: Page, selector: string, input: { deltaY: number; wheelDeltaY: number }) {
  const viewport = page.locator(selector)
  await viewport.evaluate(node => { node.scrollTop = 500 })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const bounds = await viewport.boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  return viewport.evaluate(async (node, input) => {
    const bounds = node.getBoundingClientRect()
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)!
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: input.deltaY })
    Object.defineProperty(event, 'wheelDeltaY', { value: input.wheelDeltaY })
    const before = node.scrollTop, start = performance.now()
    const frames: { time: number; distance: number }[] = []
    target.dispatchEvent(event)
    const immediate = node.scrollTop - before
    do {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      frames.push({ time: performance.now() - start, distance: node.scrollTop - before })
    } while (performance.now() - start < 600)
    return { prevented: event.defaultPrevented, immediate, frames, target: target.tagName, inside: node.contains(target) }
  }, input)
}

export async function verifyRequirementSmoothScroll(context: BrowserContext, origin: string) {
  const created = await context.request.post(`${origin}/api/requirements`, { data: { title: '平滑滚动回归', templateId: null } })
  expect(created.ok()).toBe(true)
  const requirement = await created.json() as { id: string }
  const contentJson = { type: 'doc', content: Array.from({ length: 150 }, (_, index) => ({
    type: index % 10 ? 'paragraph' : 'heading', attrs: { diffId: `smooth_${index}`, ...(index % 10 ? {} : { level: 2 }) },
    content: [{ type: 'text', text: `第 ${index + 1} 段：保留鼠标滚轮惯性与连续位移。`.repeat(8) }],
  })) }
  const seeded = await context.request.post(`${origin}/api/requirements/${requirement.id}/revisions`, {
    data: { schemaVersion: DOCUMENT_SCHEMA_VERSION, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES, title: '平滑滚动回归', changeNote: '滚动验证', contentJson },
  })
  expect(seeded.ok()).toBe(true)
  const page = await context.newPage(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1732, height: 942 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const editor = page.locator('.tiptap[contenteditable="true"]')
  const editorViewport = '.requirement-editor__scroll > .bing-scrollbar__viewport'
  const diffViewport = '.rich-diff__body > .bing-scrollbar__viewport'
  async function verify(label: string, selector: string) {
    for (const input of [
      ...[120, 80, 96].map(deltaY => ({ deltaY, wheelDeltaY: -120 })),
      { deltaY: 100 / 1.1, wheelDeltaY: -109 },
      { deltaY: 80, wheelDeltaY: -96 },
      { deltaY: -100 / 1.1, wheelDeltaY: 109 },
    ]) {
      const result = await sampleWheel(page, selector, input)
      const targetDistance = input.deltaY * 100 / 120
      const distances = result.frames.map(frame => frame.distance)
      console.log(JSON.stringify({ scenario: label, ...input, prevented: result.prevented, immediate: result.immediate,
        distinct: new Set(distances).size, final: distances.at(-1), target: result.target }))
      expect(result.inside, `${label} 命中当前滚动区`).toBe(true)
      expect(result.prevented, `${label} 接管离散滚轮`).toBe(true)
      expect(result.immediate, `${label} 不立即跳动`).toBe(0)
      expect(new Set(distances).size, `${label} 有连续动画帧`).toBeGreaterThan(3)
      expect(distances.some(distance => distance * Math.sign(targetDistance) > 0 && Math.abs(distance) < Math.abs(targetDistance) - 1)).toBe(true)
      expect(Math.abs(distances.at(-1)! - targetDistance), `${label} 完成惯性位移`).toBeLessThan(1)
    }
  }
  try {
    await page.goto(`${origin}/requirements/${requirement.id}`)
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await verify('首次正文', editorViewport)
    await page.getByRole('tab', { name: '版本比较', exact: true }).click()
    await expect(page.locator('.rich-diff')).toBeVisible()
    await verify('版本比较', diffViewport)
    await page.getByRole('tab', { name: '正文', exact: true }).click()
    await expect(editor).toBeVisible()
    await verify('比较返回正文', editorViewport)
    for (const destination of ['工作台', '文档']) {
      await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: destination, exact: true }).click()
      await expect(editor).toHaveCount(0)
      await page.evaluate(path => {
        const root = document.querySelector('#__nuxt') as HTMLElement & { __vue_app__: { $nuxt: { $router: { push: (path: string) => Promise<unknown> } } } }
        return root.__vue_app__.$nuxt.$router.push(path)
      }, `/requirements/${requirement.id}`)
      await expect(editor).toBeVisible()
      await verify(`${destination}返回详情`, editorViewport)
    }
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await context.request.delete(`${origin}/api/requirements/${requirement.id}`)
  }
}
