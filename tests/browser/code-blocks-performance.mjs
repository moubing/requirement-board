import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { expect } from '@playwright/test'

/** 聚焦编辑器，真实正文/原图、输入和滚轮；不代表网络/API 或物理屏幕延迟。 */
export async function measureCodeBlocks(page) {
  const source = process.env.BROWSER_TEST_DOCUMENT, images = process.env.BROWSER_TEST_IMAGES_DIR
  const output = process.env.BROWSER_TEST_ARTIFACT_DIR
  if (!source || !images || !output) throw new Error('代码块性能验证需要正文样本、原图目录和产物目录')
  const document = JSON.parse(await readFile(source, 'utf8')).contentJson
  await page.route('**/uploads/*', route => route.fulfill({ path: join(images, basename(new URL(route.request().url()).pathname)) }))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const results = []
  for (let round = 1; round <= 3; round++) {
    const mount = await page.evaluate(async content => {
      const start = performance.now()
      await window.editorFixture.mount(true, content)
      await document.fonts.ready
      await Promise.all([...document.querySelectorAll('.tiptap img')].map(img => img.decode().catch(() => {})))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return performance.now() - start
    }, document)
    expect(await page.locator('.tiptap img').evaluateAll(nodes => nodes.filter(n => n.complete && n.naturalWidth > 0).length)).toBe(37)
    const original = await page.evaluate(() => window.editorFixture.editor().getJSON())
    const positions = await page.evaluate(() => {
      const positions = []
      window.editorFixture.editor().state.doc.descendants((node, pos) => { if (node.isTextblock && node.type.name !== 'imageCaption') positions.push(pos + 1) })
      return [positions[0], positions[Math.floor(positions.length / 2)], positions.at(-1)]
    })
    const input = []
    for (const pos of positions) {
      await page.evaluate(pos => {
        const editor = window.editorFixture.editor(); editor.commands.setTextSelection(pos); editor.commands.scrollIntoView(); editor.view.focus()
        const stats = { handlers: [], frames: [], longtasks: [] }; let started
        const before = () => { started = performance.now() }
        const after = () => { const begin = started; stats.handlers.push(performance.now() - begin); requestAnimationFrame(() => requestAnimationFrame(() => stats.frames.push(performance.now() - begin))) }
        const observer = new PerformanceObserver(list => stats.longtasks.push(...list.getEntries().map(e => e.duration)))
        observer.observe({ type: 'longtask' })
        editor.view.dom.addEventListener('beforeinput', before, true); editor.view.dom.addEventListener('input', after)
        window.codePerformance = { finish() { observer.disconnect(); editor.view.dom.removeEventListener('beforeinput', before, true); editor.view.dom.removeEventListener('input', after); return stats } }
        window.editorFixture.separateHistory()
      }, pos)
      await page.keyboard.type('const answer = 42; '.repeat(2), { delay: 35 })
      await page.waitForTimeout(250)
      input.push(await page.evaluate(() => window.codePerformance.finish()))
      await page.keyboard.press('Control+z')
      expect(await page.evaluate(() => window.editorFixture.editor().getJSON())).toEqual(original)
    }
    const viewport = page.getByRole('region', { name: '文档正文', exact: true })
    const scroll = await viewport.evaluate(element => {
      element.scrollTop = 0
      const frames = []; let previous = 0, frame, maxTop = 0
      const tick = now => { if (previous) frames.push(now - previous); previous = now; maxTop = Math.max(maxTop, element.scrollTop); frame = requestAnimationFrame(tick) }
      frame = requestAnimationFrame(tick)
      window.codeScroll = { finish() { cancelAnimationFrame(frame); return { frames, maxTop, height: element.scrollHeight, viewport: element.clientHeight } } }
      const rect = element.getBoundingClientRect()
      return { x: rect.x + 100, y: rect.y + 100, step: Math.ceil(element.scrollHeight / 20) }
    })
    await page.mouse.move(scroll.x, scroll.y)
    for (let i = 0; i < 50; i++) { await page.mouse.wheel(0, (i < 28 ? 1 : -1) * scroll.step); await page.waitForTimeout(45) }
    const scrolling = await page.evaluate(() => window.codeScroll.finish())
    expect(scrolling.maxTop).toBeGreaterThan((scrolling.height - scrolling.viewport) * .9)
    results.push({ round, mount, input, scrolling })
    console.log(`代码块性能：${process.env.BROWSER_TEST_CODE_BASELINE ? 'REQ-30 基线' : '候选'} 第 ${round} 轮完成`)
  }
  const distribution = values => { values.sort((a, b) => a - b); return { count: values.length, p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], max: values.at(-1) } }
  const summary = {
    inputHandler: distribution(results.flatMap(r => r.input.flatMap(x => x.handlers))),
    inputTwoFrames: distribution(results.flatMap(r => r.input.flatMap(x => x.frames))),
    inputLongTasks: distribution(results.flatMap(r => r.input.flatMap(x => x.longtasks))),
    scrollFrames: distribution(results.flatMap(r => r.scrolling.frames)),
    mount: results.map(r => r.mount),
  }
  await mkdir(output, { recursive: true })
  const baseline = process.env.BROWSER_TEST_CODE_BASELINE ?? null
  await writeFile(join(output, `code-performance-${baseline ? 'baseline' : 'candidate'}.json`), JSON.stringify({ baseline, browser: page.context().browser().version(), topLevelBlocks: document.content.length, results, summary }, null, 2))
  console.log(JSON.stringify(summary))
}
