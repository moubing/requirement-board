import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { cpus, platform } from 'node:os'
import { expect, type BrowserContext, type CDPSession } from '@playwright/test'
import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'
import { DOCUMENT_SCHEMA_VERSION } from '../../shared/agent/suggestions'
import { DOCUMENT_NODE_CAPABILITIES } from '../../shared/editor/capabilities'
import { verifyCachedRequirementSafety } from './cached-requirement-safety'
import { verifyInputPerformance } from './requirement-input-performance'

// 使用真实 Nuxt 路由、接口、WebSocket 和原图。样本文件由调用方提供，不写入仓库。
export async function verifyRequirementPerformance(context: BrowserContext, origin: string) {
  const baseline = process.env.BROWSER_TEST_PERFORMANCE_BASELINE === '1'
  const artifactDir = process.env.BROWSER_TEST_ARTIFACT_DIR
  const fixtureFiles = [process.env.BROWSER_TEST_DOCUMENT_V4, process.env.BROWSER_TEST_DOCUMENT_V5]
  const originals = process.env.BROWSER_TEST_IMAGES_DIR
  const repeats = Number(process.env.BROWSER_TEST_PERFORMANCE_REPEATS ?? 20)
  const cpuRate = Number(process.env.BROWSER_TEST_CPU_RATE ?? 1)
  const result: Record<string, unknown> = { baseline, viewport: [1732, 942], repeats, browser: context.browser()?.version(),
    cpu: cpus()[0]?.model, cpuRate, platform: platform(), timing: '点击到 DOM 可用及两个 rAF；不是最终呈现时间' }
  if (artifactDir) await mkdir(artifactDir, { recursive: true })
  async function create(title: string) {
    const response = await context.request.post(`${origin}/api/requirements`, { data: { title, templateId: null } })
    expect(response.ok()).toBe(true)
    return await response.json() as { id: string; key: string; title: string }
  }
  const a = await create('REQ-10 长文档回归')
  result.documentId = a.id
  const b = await create('REQ-10 缓存第二篇')
  const c = await create('REQ-10 缓存第三篇')
  console.log('性能验证：文档已创建，准备原图与版本。')
  const documents: RichTextDocument[] = []
  for (const [index, file] of fixtureFiles.entries()) {
    documents.push(file ? JSON.parse(await readFile(file, 'utf8')).contentJson : {
      type: 'doc', content: Array.from({ length: 100 }, (_, i) => ({ type: 'paragraph', attrs: { diffId: `perf_${i}` },
        content: [{ type: 'text', text: `第 ${i + 1} 段长文档验证 ${index && i % 7 === 0 ? '已修改' : '正文'}。`.repeat(10) }] })),
    })
  }
  const sources = new Set<string>()
  function visit(node: RichTextNode, action: (node: RichTextNode) => void) { action(node); node.content?.forEach(child => visit(child, action)) }
  documents.forEach(doc => visit(doc, node => { if (node.type === 'image') sources.add(String(node.attrs?.src ?? '')) }))
  const urls = new Map<string, string>()
  for (const source of sources) {
    if (!originals || !/^\/uploads\/asset_[\w-]+\.(png|jpe?g|gif|webp)$/i.test(source)) throw new Error('真实图片样本缺失或 URL 不符合允许的上传路径')
    const filename = basename(source), extension = extname(filename).slice(1)
    const response = await context.request.post(`${origin}/api/assets/upload?requirementId=${a.id}`, {
      multipart: { file: { name: filename, mimeType: `image/${extension === 'jpg' ? 'jpeg' : extension}`, buffer: await readFile(join(resolve(originals), filename)) } },
    })
    expect(response.ok(), await response.text()).toBe(true)
    urls.set(source, (await response.json()).url)
  }
  let revisionId = ''
  for (const [index, contentJson] of documents.entries()) {
    visit(contentJson, node => { if (node.type === 'image' && node.attrs) node.attrs.src = urls.get(String(node.attrs.src)) })
    const response = await context.request.post(`${origin}/api/requirements/${a.id}/revisions`, {
      data: { ...(!baseline ? { schemaVersion: DOCUMENT_SCHEMA_VERSION, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES } : {}), title: a.title, changeNote: `真实样本 v${index + 4}`, contentJson },
    })
    expect(response.ok(), await response.text()).toBe(true)
    revisionId = (await response.json()).id
  }
  result.sample = { blocks: documents[1]!.content?.length, images: sources.size, originals: Boolean(originals) }
  console.log('性能验证：原图与版本已就绪，开始真实页面验证。')
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1732, height: 942 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    Object.assign(window, { __RB_DETAIL_RETURN_TIMING__: true })
    const stats = { resizeTargets: 0, sockets: 0, longTasks: [] as number[] }
    Object.assign(window, { requirementPerformance: stats })
    const NativeResizeObserver = window.ResizeObserver
    window.ResizeObserver = class extends NativeResizeObserver {
      targets = new Set<Element>()
      observe(target: Element, options?: ResizeObserverOptions) { if (!this.targets.has(target)) { this.targets.add(target); stats.resizeTargets++ }; super.observe(target, options) }
      unobserve(target: Element) { if (this.targets.delete(target)) stats.resizeTargets--; super.unobserve(target) }
      disconnect() { stats.resizeTargets -= this.targets.size; this.targets.clear(); super.disconnect() }
    }
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        let counted = false
        this.addEventListener('open', () => { counted = true; stats.sockets++ })
        this.addEventListener('close', () => { if (counted) stats.sockets-- })
      }
    }
    new PerformanceObserver(list => stats.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true })
  })
  const editor = page.locator('.tiptap[contenteditable="true"]')
  const viewport = page.locator('.requirement-editor__scroll > .bing-scrollbar__viewport')
  const diff = page.locator('.rich-diff')
  const now = () => page.evaluate(() => performance.now())
  async function frames() { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
  async function navigate(path: string) {
    await page.evaluate(path => {
      const root = document.querySelector('#__nuxt') as HTMLElement & { __vue_app__: { $nuxt: { $router: { push: (path: string) => Promise<unknown> } } } }
      return root.__vue_app__.$nuxt.$router.push(path)
    }, path)
  }
  async function resources() {
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    return { ...(await cdp.send('Memory.getDOMCounters')), heapUsedBytes: heap.usedSize, ...(await page.evaluate(() => {
      const stats = (window as unknown as { requirementPerformance: { resizeTargets: number; sockets: number } }).requirementPerformance
      return { resizeTargets: stats.resizeTargets, sockets: stats.sockets, visibleElements: document.querySelectorAll('*').length }
    })) }
  }
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  const startTrace = () => cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,cc,benchmark', transferMode: 'ReturnAsStream' })
  async function saveTrace(name: string) {
    const completed = new Promise<{ stream: string }>(resolve => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.end')
    const trace = await readTrace(cdp, (await completed).stream)
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, `${name}.json`), trace) }
  }
  const readSignature = async () => (await (await context.request.post(`${origin}/api/requirements/${a.id}/collaboration`, { data: {} })).json()).signature as string
  try {
    await page.goto(`${origin}/requirements/${a.id}?revision=${revisionId}`)
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.tiptap img')].every(image => image.complete && image.naturalWidth))
    await page.mouse.move(10, 10)
    await frames()
    const originalSignature = await readSignature()
    result.initial = { elements: await editor.locator('*').count(), buttons: await editor.locator('button').count(), diffMounted: await diff.count() }
    if (process.env.BROWSER_TEST_PERFORMANCE_INPUT_ONLY === '1') {
      await startTrace()
      result.input = await verifyInputPerformance(page, cdp, Number(process.env.BROWSER_TEST_INPUT_SECONDS ?? 30), Number(process.env.BROWSER_TEST_IME_SECONDS ?? 0))
      await saveTrace('input')
      await expect.poll(readSignature, { timeout: 30_000, message: '输入、确认和撤销后服务器正文完整恢复' }).toBe(originalSignature)
      result.contentUnchanged = true
      expect(errors).toEqual([])
      return
    }
    console.log('性能验证：正文已加载，开始比较切换。')
    if (!baseline) expect(await diff.count(), '首次正文不创建比较器').toBe(0)
    const sourceEditor = await editor.elementHandle()
    const diffTimes: number[] = [], bodyTimes: number[] = []
    await startTrace()
    for (let i = 0; i <= repeats; i++) {
      let start = await now()
      await page.getByRole('tab', { name: '版本比较', exact: true }).click()
      await expect(diff).toBeVisible(); await expect(diff.locator('.rich-diff__row').first()).toBeVisible()
      await frames(); diffTimes.push(await now() - start)
      const current = await diff.elementHandle()
      start = await now()
      await page.getByRole('tab', { name: '正文', exact: true }).click()
      await expect(editor).toBeVisible(); await frames(); bodyTimes.push(await now() - start)
      if (!baseline) expect(await current!.evaluate(node => node.isConnected), '隐藏比较器保留 DOM').toBe(true)
      await current?.dispose()
    }
    await saveTrace('view-switch')
    result.diffMs = diffTimes; result.bodyMs = bodyTimes
    if (!baseline) {
      await page.getByRole('tab', { name: '版本比较', exact: true }).click()
      const comparisonViewport = diff.locator('.bing-scrollbar__viewport').first()
      await comparisonViewport.evaluate(node => { node.scrollTop = 700 })
      await frames()
      const comparisonTop = await comparisonViewport.evaluate(node => node.scrollTop)
      await navigate('/')
      await navigate(`/requirements/${a.id}?revision=${revisionId}`)
      await expect(diff).toBeVisible()
      await expect.poll(() => comparisonViewport.evaluate(node => node.scrollTop)).toBeCloseTo(comparisonTop, 0)
      await page.getByRole('tab', { name: '正文', exact: true }).click()
      await expect(editor).toBeVisible()
    }
    console.log('性能验证：比较切换完成，开始侧栏往返。')
    await viewport.evaluate(node => { node.scrollTop = 1000 })
    await frames()
    const top = await viewport.evaluate(node => node.scrollTop)
    const routeTimes: Record<string, { leave: number[]; enter: number[] }> = {}
    const returnStages: Record<string, unknown[]> = {}
    const samples: unknown[] = []
    await startTrace()
    for (const [label, path] of [['工作台', '/'], ['文档', '/requirements'], ['模板管理', '/templates'], ['成员管理', '/members']]) {
      const times = routeTimes[label!] = { leave: [], enter: [] }
      const stages = returnStages[label!] = []
      for (let i = 0; i < repeats; i++) {
        let start = await now()
        await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: label, exact: true }).click()
        await expect(page).toHaveURL(`${origin}${path}`); await expect(editor).toHaveCount(0); await frames()
        times.leave.push(await now() - start)
        start = await now()
        await navigate(`/requirements/${a.id}?revision=${revisionId}`)
        await expect(editor).toBeVisible(); await frames()
        times.enter.push(await now() - start)
        stages.push(await page.evaluate(() => {
          const entries = performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('rb:detail-return:')) as PerformanceMeasure[]
          const run = entries.findLast(entry => entry.name === 'rb:detail-return:navigation')?.detail?.run
          const measured = entries.filter(entry => entry.detail?.run === run).map(entry => ({
            phase: entry.name.replace('rb:detail-return:', ''), start: entry.startTime - entry.detail.started, duration: entry.duration,
          }))
          for (const name of new Set(entries.map(entry => entry.name))) performance.clearMeasures(name)
          return measured
        }))
        if (!baseline) {
          const phases = (stages.at(-1) as { phase: string }[]).map(entry => entry.phase)
          expect(phases).toEqual(expect.arrayContaining(['access', 'activated', 'detail-fetch', 'collaboration-fetch', 'collaboration-apply', 'editable', 'frames-ready']))
          expect(phases, '无正文变化的返回不触发全文导出').not.toContain('document-export')
        }
        if (!baseline) expect(await editor.evaluate((node, original) => node === original, sourceEditor)).toBe(true)
        await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeCloseTo(top, 0)
        if (label === '工作台' && (i === 0 || i === repeats - 1)) samples.push(await resources())
      }
      console.log(`性能验证：${label} ${repeats} 次往返完成。`)
    }
    await saveTrace('navigation')
    result.routesMs = routeTimes; result.resourceCycles = samples; result.returnStages = returnStages
    await sourceEditor?.dispose()
    const evicted = await editor.elementHandle()
    if (!baseline) {
      const second = await context.request.post(`${origin}/api/requirements/${b.id}/revisions`, { data: { schemaVersion: DOCUMENT_SCHEMA_VERSION, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES, title: b.title, contentJson: documents[1], changeNote: '第二份长文档缓存验证' } })
      expect(second.ok()).toBe(true)
    }
    for (const id of [b.id, c.id, a.id]) {
      await navigate(`/requirements/${id}`); await expect(editor).toBeVisible()
      if (!baseline && id === b.id) result.twoLongDocuments = await resources()
    }
    if (!baseline) expect(await editor.evaluate((node, original) => node !== original, evicted), '第三篇淘汰最早实例').toBe(true)
    await evicted?.dispose()
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeCloseTo(top, 0)
    // 真实 Chromium 的 Style/Layout/Script CPU 时间；Trace 保留绘制事件供 DevTools 检查。
    const scroll: unknown[] = []
    for (let run = 0; run < Number(process.env.BROWSER_TEST_PERFORMANCE_SCROLL_RUNS ?? 3); run++) {
      await viewport.evaluate(node => { node.scrollTop = 0 })
      const box = await viewport.boundingBox()
      await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .5)
      await page.waitForTimeout(250)
      const maximum = await viewport.evaluate(node => node.scrollHeight - node.clientHeight)
      const wheelStep = 700
      await startTrace()
      const before = await metrics(cdp), start = await now()
      let maximumReached = 0
      let wheelEvents = 0
      // 覆盖全文、文末图片/表格及反向滚动；各轮使用同一操作路线。
      // 内层代码块可消费部分滚轮，BingScrollbar 也会限制单次位移，不能只累加输入当作覆盖距离。
      for (const direction of [1, -1]) {
        for (let step = 0; step < 220; step++) {
          await page.mouse.wheel(0, direction * wheelStep); wheelEvents++
          await page.waitForTimeout(50)
          const top = await viewport.evaluate(node => node.scrollTop)
          maximumReached = Math.max(maximumReached, top)
          if (direction === 1 ? top >= maximum - 1 : top <= 1) break
        }
      }
      await viewport.evaluate(node => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2 })
      for (let step = 0; step < 40; step++) { await page.mouse.wheel(0, step % 4 < 2 ? 500 : -500); await page.waitForTimeout(50) }
      const durationMs = await now() - start, after = await metrics(cdp)
      await saveTrace(`scroll-${run + 1}`)
      expect(maximumReached).toBeGreaterThanOrEqual(maximum * .95)
      scroll.push({ durationMs, maximum, maximumReached, wheelEvents, styleMsPerSecond: (after.RecalcStyleDuration! - before.RecalcStyleDuration!) * 1e6 / durationMs,
        layoutMsPerSecond: (after.LayoutDuration! - before.LayoutDuration!) * 1e6 / durationMs,
        scriptMsPerSecond: (after.ScriptDuration! - before.ScriptDuration!) * 1e6 / durationMs })
      console.log(`性能验证：第 ${run + 1} 段滚动 Trace 完成。`)
    }
    result.scroll = scroll
    result.finalResources = await resources()
    result.longTasks = await page.evaluate(() => (window as unknown as { requirementPerformance: { longTasks: number[] } }).requirementPerformance.longTasks)
    result.contentUnchanged = await readSignature() === originalSignature
    expect(result.contentUnchanged, '纯滚动、切换与路由往返不改正文').toBe(true)
    if (process.env.BROWSER_TEST_INPUT_SECONDS) {
      await startTrace()
      result.input = await verifyInputPerformance(page, cdp, Number(process.env.BROWSER_TEST_INPUT_SECONDS), Number(process.env.BROWSER_TEST_IME_SECONDS ?? 0))
      await saveTrace('input')
      await expect.poll(readSignature, { timeout: 30_000, message: '输入和撤销后服务器正文完整恢复' }).toBe(originalSignature)
      result.inputContentUnchanged = true
    }
    if (!baseline) {
      await verifyCachedRequirementSafety(page, context, origin, a.id)
      result.cacheSafety = '远端增量、AI 锁及代次、403 淘汰、账号切换通过'
    }
    expect(errors).toEqual([])
    console.log('通过：真实长文档、原图、20 次比较切换、四个侧栏页面往返、实例复用与三篇文档淘汰。')
  } catch (error) {
    result.failure = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    result.errors = errors
    if (artifactDir) { await mkdir(artifactDir, { recursive: true }); await writeFile(join(artifactDir, 'results.json'), JSON.stringify(result, null, 2)) }
    await cdp.detach(); await page.close()
  }
}

async function metrics(cdp: CDPSession) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
}
async function readTrace(cdp: CDPSession, handle: string) {
  const chunks: Buffer[] = []
  try {
    while (true) { const part = await cdp.send('IO.read', { handle }); chunks.push(Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8')); if (part.eof) break }
  } finally { await cdp.send('IO.close', { handle }) }
  return Buffer.concat(chunks)
}
