import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { expect } from '@playwright/test'

/** 真实样本/原图 + 真实输入与滚轮；两个 rAF 是内部代理值，不冒充最终呈现。 */
export async function measureVersionMarkers(page, url) {
  const samplePath = process.env.BROWSER_TEST_DOCUMENT_V5
  const images = process.env.BROWSER_TEST_IMAGES_DIR
  if (!samplePath || !images) throw new Error('性能对照需要 BROWSER_TEST_DOCUMENT_V5 与 BROWSER_TEST_IMAGES_DIR')
  const source = JSON.parse(await readFile(samplePath, 'utf8'))
  const sample = source.contentJson
  const countNodes = (node, type) => Number(node.type === type) + (node.content ?? []).reduce((sum, child) => sum + countNodes(child, type), 0)
  const imageCount = countNodes(sample, 'image')
  await page.route('**/uploads/*', async route => {
    const name = basename(new URL(route.request().url()).pathname)
    await route.fulfill({ path: join(images, name) })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const results = []
  for (let round = 1; round <= 3; round++) {
    for (const enabled of round % 2 ? [false, true] : [true, false]) {
      await page.goto(url)
      await expect(page.locator('.tiptap')).toBeVisible()
      await page.evaluate(({ sample, enabled }) => {
        window.workspaceFixture.preferences.setVersionMarkers(enabled)
        window.workspaceFixture.setComparison(structuredClone(sample), structuredClone(sample))
      }, { sample, enabled })
      await expect(page.getByRole('status', { name: '版本保存状态', exact: true })).toHaveText('与最新版本一致', { timeout: 30000 })
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all([...document.querySelectorAll('.tiptap img')].map(image => image.decode().catch(() => {})))
      })
      expect(await page.locator('.tiptap img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth > 0).length)).toBe(imageCount)
      // 预热一次正文核对；保留这次输入，避免夹具装载和输入合并进同一撤销事件。
      await page.locator('.tiptap').evaluate(element => {
        const e = element.editor
        let pos
        e.state.doc.descendants((node, position) => { if (pos === undefined && node.isTextblock) pos = position + 1 })
        e.commands.setTextSelection(pos)
        e.view.dom.focus({ preventScroll: true })
      })
      await page.keyboard.insertText('预热')
      await page.waitForTimeout(500)
      expect(await page.locator('.tiptap').evaluate(element => element.editor.state.doc.childCount)).toBe(sample.content.length)
      await page.evaluate(() => {
        const surface = document.querySelector('.tiptap')
        const stats = { input: [], frames: [], longtasks: [] }
        let started = 0, previous = 0, frame, collecting = true
        const before = () => { started = performance.now() }
        const input = () => {
          const begin = started, handled = performance.now() - begin
          requestAnimationFrame(() => requestAnimationFrame(() => stats.input.push({ handled, frames: performance.now() - begin })))
        }
        surface.addEventListener('beforeinput', before, true)
        surface.addEventListener('input', input)
        const tick = now => { if (previous) stats.frames.push(now - previous); previous = now; if (collecting) frame = requestAnimationFrame(tick) }
        frame = requestAnimationFrame(tick)
        const observer = new PerformanceObserver(list => stats.longtasks.push(...list.getEntries().map(item => item.duration)))
        observer.observe({ type: 'longtask' })
        window.versionMarkerMeasurement = { stats, finish() {
          collecting = false; cancelAnimationFrame(frame); observer.disconnect()
          surface.removeEventListener('beforeinput', before, true); surface.removeEventListener('input', input)
          return stats
        } }
      })
      await page.keyboard.type('abcdefghijklmnopqrstuvwxyz'.repeat(3), { delay: 55 })
      await page.waitForTimeout(400)
      const typing = await page.evaluate(() => window.versionMarkerMeasurement.finish())
      const viewport = page.getByRole('region', { name: '文档正文', exact: true })
      const scroll = await viewport.evaluate(element => {
        element.scrollTop = 0
        const frames = []
        let frame, previous = 0, maxTop = 0
        const tick = now => { if (previous) frames.push(now - previous); previous = now; maxTop = Math.max(maxTop, element.scrollTop); frame = requestAnimationFrame(tick) }
        frame = requestAnimationFrame(tick)
        window.versionMarkerScroll = { finish() { cancelAnimationFrame(frame); return { frames, maxTop, top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight } } }
        return { left: element.getBoundingClientRect().left + 100, top: element.getBoundingClientRect().top + 100, step: Math.ceil(element.scrollHeight / 32) }
      })
      await page.mouse.move(scroll.left, scroll.top)
      for (let index = 0; index < 60; index++) { await page.mouse.wheel(0, index < 40 ? scroll.step : -scroll.step); await page.waitForTimeout(45) }
      const scrolling = await page.evaluate(() => window.versionMarkerScroll.finish())
      expect(scrolling.maxTop).toBeGreaterThan((scrolling.height - scrolling.viewport) * .9)
      expect(await page.locator('.tiptap').evaluate(element => element.editor.state.doc.childCount)).toBe(sample.content.length)
      const entry = { round, enabled, typing, scrolling }
      results.push(entry)
      console.log(`版本标记性能：第 ${round} 轮，${enabled ? '开启' : '关闭'}，${typing.input.length} 次输入`)
    }
  }
  const distribution = values => {
    values.sort((a, b) => a - b)
    return { count: values.length, p50: values[Math.floor(values.length * .5)] ?? 0, p95: values[Math.floor(values.length * .95)] ?? 0, max: values.at(-1) ?? 0 }
  }
  const summary = [false, true].map(enabled => {
    const group = results.filter(item => item.enabled === enabled)
    return { enabled, inputHandlerMs: distribution(group.flatMap(item => item.typing.input.map(sample => sample.handled))),
      inputTwoFramesMs: distribution(group.flatMap(item => item.typing.input.map(sample => sample.frames))),
      typingFrameMs: distribution(group.flatMap(item => item.typing.frames)), scrollFrameMs: distribution(group.flatMap(item => item.scrolling.frames)),
      typingLongTasks: distribution(group.flatMap(item => item.typing.longtasks)) }
  })
  const report = { sample: { key: source.key, version: source.latestRevision?.version, topLevelBlocks: sample.content.length, images: imageCount, tables: countNodes(sample, 'table') },
    date: new Date().toISOString(), browser: page.context().browser().version(), summary, results }
  if (process.env.BROWSER_TEST_ARTIFACT_DIR) {
    await mkdir(process.env.BROWSER_TEST_ARTIFACT_DIR, { recursive: true })
    await writeFile(join(process.env.BROWSER_TEST_ARTIFACT_DIR, 'version-markers-performance.json'), JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify({ sample: report.sample, summary }, null, 2))
}
