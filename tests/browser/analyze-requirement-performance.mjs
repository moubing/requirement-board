import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const directory = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('用法：node tests/browser/analyze-requirement-performance.mjs <Trace 目录>')
const result = JSON.parse(await readFile(join(directory, 'results.json'), 'utf8'))
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return { count: sorted.length, median: percentile(.5), p95: percentile(.95), max: sorted.at(-1) ?? null,
    over50: sorted.filter(value => value > 50).length, total: sorted.reduce((a, b) => a + b, 0) }
}
function unionDuration(events) {
  const groups = new Map()
  for (const event of events) {
    const key = `${event.pid}:${event.tid}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push([event.ts, event.ts + event.dur])
  }
  let total = 0
  for (const intervals of groups.values()) {
    intervals.sort((a, b) => a[0] - b[0])
    let start = 0, end = 0
    for (const [nextStart, nextEnd] of intervals) {
      if (nextStart > end) { total += end - start; start = nextStart; end = nextEnd }
      else end = Math.max(end, nextEnd)
    }
    total += end - start
  }
  return total / 1000
}
async function analyze(name, durationMs) {
  // 降速后的导航 Trace 也可能很大，只保留统计所需事件，避免整份 JSON 的解析峰值。
  const names = new Set(['ResourceSendRequest', 'ResourceReceiveResponse', 'ResourceFinish', 'AnimationFrame::Presentation',
    'PipelineReporter', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'ImageFrameGenerator::decode', 'EventDispatch', 'EventTiming'])
  const markers = [...names].map(value => `"name":"${value}"`)
  const events = []
  const lines = createInterface({ input: createReadStream(join(directory, `${name}.json`), { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!markers.some(value => line.includes(value))) continue
    const event = JSON.parse(line.trim().replace(/,$/, ''))
    if (names.has(event.name)) events.push(event)
  }
  const requests = new Map()
  for (const event of events) {
    const data = event.args?.data
    if (!data?.requestId) continue
    if (event.name === 'ResourceSendRequest' && data.url) {
      const path = new URL(data.url).pathname
      const match = path.match(/^\/api\/requirements\/[^/]+(?:\/(collaboration|revisions|related))?$/)
      if (match) requests.set(data.requestId, { kind: match[1] ?? 'detail', start: event.ts })
    }
    const request = requests.get(data.requestId)
    if (!request) continue
    if (event.name === 'ResourceReceiveResponse') request.response = event.ts
    if (event.name === 'ResourceFinish') { request.end = event.ts; request.bytes = data.encodedDataLength }
  }
  const network = Object.fromEntries([...new Set([...requests.values()].map(request => request.kind))].map(kind => {
    const selected = [...requests.values()].filter(request => request.kind === kind)
    return [kind, { requests: selected.length,
      responseMs: summary(selected.flatMap(request => request.response ? [(request.response - request.start) / 1000] : [])),
      completeMs: summary(selected.flatMap(request => request.end ? [(request.end - request.start) / 1000] : [])),
      encodedBytes: summary(selected.flatMap(request => Number.isFinite(request.bytes) ? [request.bytes] : [])) }]
  }))
  const presentation = [...new Set(events.filter(event => event.name === 'AnimationFrame::Presentation').map(event => event.ts))].sort((a, b) => a - b)
  const gaps = presentation.slice(1).map((time, i) => (time - presentation[i]) / 1000)
  const primary = {}, forked = {}
  let affectsSmoothness = 0
  for (const event of events) {
    if (event.name !== 'PipelineReporter' || event.ph !== 'b' || !event.args?.frame_reporter) continue
    const frame = event.args.frame_reporter
    const states = frame.frame_type === 'FORKED' ? forked : primary
    states[frame.state] = (states[frame.state] ?? 0) + 1
    if (frame.affects_smoothness) affectsSmoothness++
  }
  // 合并同线程嵌套区间；这组事件是本报告的渲染口径，不冒充 DevTools 所有 Rendering 分类。
  const renderingNames = ['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize']
  const renderingMs = unionDuration(events.filter(event => renderingNames.includes(event.name) && event.ph === 'X' && event.dur))
  const paintMs = unionDuration(events.filter(event => event.name === 'Paint' && event.ph === 'X' && event.dur))
  const decodeMs = unionDuration(events.filter(event => event.name === 'ImageFrameGenerator::decode' && event.ph === 'X' && event.dur))
  const clickNextPresentation = events.filter(event => event.name === 'EventDispatch' && event.args?.data?.type === 'click')
    .flatMap(event => { const next = presentation.find(time => time >= event.ts + (event.dur ?? 0)); return next ? [(next - event.ts) / 1000] : [] })
  const clicks = events.filter(event => event.name === 'EventTiming' && event.ph === 'b'
    && event.args?.data?.type === 'click' && event.args.data.duration > 0)
    .sort((a, b) => a.ts - b.ts).map(event => event.args.data.duration)
  // 切换 Trace 内只有交替的比较/正文点击；数量完整时才按顺序拆分，缺失时不猜测。
  const switchClicks = name === 'view-switch' && clicks.length === (result.diffMs?.length ?? 0) * 2
    ? { firstDiffMs: clicks[0], hotDiffMs: summary(clicks.filter((_, i) => i > 0 && i % 2 === 0)), bodyMs: summary(clicks.filter((_, i) => i % 2 === 1)) } : undefined
  return { network, presentationIntervalMs: summary(gaps), pipelinePrimary: primary, pipelineForked: forked, affectsSmoothness,
    renderingMs, renderingMsPerSecond: durationMs ? renderingMs * 1000 / durationMs : null,
    paintMs, decodeWorkerMs: decodeMs, clickToNextPresentationMs: summary(clickNextPresentation),
    clickEventPresentationMs: summary(clicks), switchClickPresentation: switchClicks }
}
async function analyzeInput() {
  if (!result.input?.length) return undefined
  // CDP Trace 每行一个事件；输入录制可达数百 MB，只保留所需事件，避免全文解析峰值。
  const events = []
  const input = createReadStream(join(directory, 'input.json'), { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.includes('"name":"EventTiming"') || !line.includes('"type":"beforeinput"')) continue
    const event = JSON.parse(line.trim().replace(/,$/, ''))
    if (event.ph === 'b' && event.args?.data?.duration > 0) events.push(event.args.data)
  }
  return result.input.map(run => {
    const samples = run.samples.map(sample => {
      // performance.now() 与 Trace 的 processingStart/End 使用同一页面时间基准。
      const event = events.find(event => event.processingStart <= sample.start + .1 && event.processingEnd >= sample.start - .1)
      return { ...sample, presentationMs: event?.duration, eventStart: event?.timeStamp }
    })
    // 本脚本的 CDP 循环严格依次发送一次组词、一次确认，二者都可能报告 insertCompositionText。
    // 只有事件数和类型完整对应时才按序拆开，不能仅凭 isComposing 判断哪次是确认。
    const pairedIme = run.method === 'ime-cdp' && run.confirmations > 0 && samples.length === run.confirmations * 2
      && samples.every(sample => sample.type === 'insertCompositionText')
    const imeConfirmation = pairedIme ? samples.filter((_, index) => index % 2 === 1) : undefined
    return { position: run.position, method: run.method, characters: run.characters, elapsedMs: run.elapsedMs,
      inputHandlerMs: summary(samples.flatMap(sample => Number.isFinite(sample.inputMs) ? [sample.inputMs] : [])),
      twoFramesProxyMs: summary(samples.flatMap(sample => Number.isFinite(sample.framesMs) ? [sample.framesMs] : [])),
      chromiumPresentationMs: summary(samples.flatMap(sample => Number.isFinite(sample.presentationMs) ? [sample.presentationMs] : [])),
      imeConfirmation: imeConfirmation ? {
        method: '严格交替的 CDP 组词/确认序列，事件数为确认数的两倍且类型一致；取每对第二个事件。',
        confirmations: run.confirmations,
        chromiumPresentationMs: summary(imeConfirmation.flatMap(sample => Number.isFinite(sample.presentationMs) ? [sample.presentationMs] : [])),
        unmatchedEvents: imeConfirmation.filter(sample => sample.presentationMs === undefined).length,
      } : undefined,
      unmatchedEvents: samples.filter(sample => sample.presentationMs === undefined).length, samples }
  })
}
const report = {
  method: 'AnimationFrame::Presentation 是无头浏览器呈现反馈；PipelineReporter 的主报告与 FORKED 分开计数，不能相加当作独立帧。点击到下一呈现事件不保证目标内容已经呈现。',
  initial: result.initial,
  firstDiffMs: result.diffMs?.[0], hotDiffMs: summary(result.diffMs?.slice(1) ?? []), bodyMs: summary(result.bodyMs ?? []),
  routesMs: Object.fromEntries(Object.entries(result.routesMs ?? {}).map(([name, timings]) => [name, { leave: summary(timings.leave), enter: summary(timings.enter) }])),
  // 阶段可能并行/嵌套，duration 不相加；start 为本轮路由中间件开始后的偏移。
  returnStages: Object.fromEntries(Object.entries(result.returnStages ?? {}).map(([name, runs]) => [name,
    Object.fromEntries([...new Set(runs.flat().map(entry => entry.phase))].map(phase => {
      const entries = runs.flat().filter(entry => entry.phase === phase)
      return [phase, { startMs: summary(entries.map(entry => entry.start)), durationMs: summary(entries.map(entry => entry.duration)),
        eventsPerReturn: summary(runs.map(run => run.filter(entry => entry.phase === phase).length)) }]
    })),
  ])),
  longTasksMs: summary(result.longTasks ?? []), resources: result.resourceCycles, twoLongDocuments: result.twoLongDocuments, finalResources: result.finalResources,
  scroll: [], viewSwitch: undefined, navigation: undefined,
  inputMethod: 'beforeinput 的 Trace EventTiming.duration 关联同一处理窗口内的有效输入；它是 Chromium 的呈现反馈，与两个 rAF 代理值分开，不能代替实体屏幕或搜狗输入法验收。',
  input: await analyzeInput(),
}
for (let i = 0; i < (result.scroll?.length ?? 0); i++) report.scroll.push({ ...result.scroll[i], ...await analyze(`scroll-${i + 1}`, result.scroll[i].durationMs) })
for (const [field, file] of [['viewSwitch', 'view-switch'], ['navigation', 'navigation']]) {
  try { report[field] = await analyze(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
await writeFile(join(directory, 'analysis.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
