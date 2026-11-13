import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { main } from '../../skills/requirement-board/scripts/rb.mjs'
import { readCachedDocument } from '../../skills/requirement-board/scripts/cache.mjs'
import { formatDiff, formatHistory, formatLog } from '../../skills/requirement-board/scripts/format.mjs'
import { agentDiff } from '../../shared/agent/diff'
import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'

const token = `rb_agent_${'a'.repeat(43)}`, origin = 'https://board.example'
const paragraph = (id: string, text: string, marks?: any[]): RichTextNode => ({ type: 'paragraph', attrs: { diffId: id }, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })
const document = (content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content })

describe('Agent 文档工具', () => {
  it('CLI 在连续读取/编辑中复用服务端正文，提交结果更新编号别名缓存，损坏时重新读取', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-tools-cache-'))
    vi.stubEnv('CODEX_HOME', root); vi.stubEnv('RB_BASE_URL', origin); vi.stubEnv('RB_TOKEN', token)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const old = { id: 'req_test', key: 'REQ-8', schemaVersion: 3, contentToken: `3:${'a'.repeat(64)}`, title: '标题', contentJson: document([paragraph('old', '原正文')]) }
    const next = { ...old, contentToken: `3:${'b'.repeat(64)}`, contentJson: document([paragraph('old', '原正文'), paragraph('server-assigned', '新正文')]) }
    let current = old
    const seen: { path: string; condition: string | null }[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const path = new URL(String(url))
      const input = options?.body ? JSON.parse(String(options.body)) : {}
      const condition = input.ifContentToken ?? path.searchParams.get('ifContentToken')
      seen.push({ path: path.pathname, condition })
      let result: any
      if (path.pathname.endsWith('/operations')) {
        current = next
        result = { status: 'applied', id: 'suggestion_abcdefghijklmnop', requirementId: current.id, document: current, revision: null }
      } else {
        result = { ...current, notModified: condition === current.contentToken, properties: { priority: 'high' } }
        if (result.notModified || path.pathname.endsWith('/status')) { delete result.contentJson; delete result.title }
        if (path.pathname.endsWith('/snapshot')) Object.assign(result, { id: 'snap_abcdefghijklmnop', requirementId: current.id, lock: { expiresAt: 'later' }, baseRevisionId: 'rev_latest' })
      }
      return new Response(JSON.stringify(result))
    })
    try {
      const out = join(root, 'document.json'), action = join(root, 'action.json')
      await main(['read', 'REQ-8', '--out', out])
      await main(['snapshot', 'REQ-8', '--out', out])
      expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({ id: 'snap_abcdefghijklmnop', cacheReused: true, contentJson: old.contentJson, properties: { priority: 'high' } })
      expect(seen[1]!.condition).toBe(old.contentToken)
      await writeFile(action, JSON.stringify({ requestId: 'abcdefghijklmnop', operations: [] }))
      await main(['submit', '--file', action])
      await main(['read', 'REQ-8', '--out', out])
      expect(seen[3]!.condition).toBe(next.contentToken)
      expect(JSON.parse(await readFile(out, 'utf8')).contentJson.content[1].attrs.diffId).toBe('server-assigned')
      await main(['status', 'REQ-8'])
      expect(log.mock.calls.at(-1)![0]).toContain('"cache": "current"')
      expect(await readCachedDocument({ origin, token: `rb_agent_${'b'.repeat(43)}` }, 'REQ-8')).toBeNull()
      expect(await readCachedDocument({ origin: 'https://other.example', token }, 'REQ-8')).toBeNull()
      const cacheRoot = join(root, 'requirement-board', 'cache')
      const partition = join(cacheRoot, (await readdir(cacheRoot))[0]!)
      for (const name of (await readdir(partition)).filter(name => name.endsWith('.json'))) await writeFile(join(partition, name), '{broken')
      await main(['read', 'REQ-8', '--out', out])
      expect(seen.at(-1)!.condition).toBeNull()
      current = { ...next, id: 'req_recreated' }
      await main(['read', 'REQ-8', '--out', out])
      expect(seen.at(-2)!.condition).toBe(next.contentToken)
      expect(seen.at(-1)!.condition).toBeNull()
      expect(JSON.parse(await readFile(out, 'utf8')).id).toBe('req_recreated')
      expect(log.mock.calls.flat().join('')).not.toContain(token)
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
  })

  it('缓存命中默认省略长正文并刷新元数据；--full 和 --out 保留全文，正文变化后正常输出', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-tools-output-'))
    vi.stubEnv('CODEX_HOME', root); vi.stubEnv('RB_BASE_URL', origin); vi.stubEnv('RB_TOKEN', token)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let current = { id: 'req_test', schemaVersion: 3, contentToken: `3:${'a'.repeat(64)}`, title: '长文档', contentJson: document([paragraph('long', '需要保留但不重复输出的正文。'.repeat(600))]) }
    const conditions: (string | null)[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      const path = new URL(String(url))
      const condition = options?.body ? JSON.parse(String(options.body)).ifContentToken : path.searchParams.get('ifContentToken')
      conditions.push(condition ?? null)
      const result: any = { ...current, notModified: condition === current.contentToken,
        properties: { priority: conditions.length > 1 ? 'high' : 'medium' }, latestRevision: { version: conditions.length } }
      if (result.notModified) { delete result.contentJson; delete result.title }
      if (path.pathname.endsWith('/snapshot')) Object.assign(result, { id: 'snap_abcdefghijklmnop', requirementId: current.id,
        baseRevisionId: 'rev_latest', lock: { expiresAt: '2026-10-04T12:30:00.000Z' } })
      return new Response(JSON.stringify(result))
    })
    const output = () => JSON.parse(log.mock.calls.at(-1)![0])
    try {
      await main(['read', 'REQ-8'])
      expect(output().contentJson).toEqual(current.contentJson)
      const fullBytes = Buffer.byteLength(log.mock.calls.at(-1)![0])
      for (const flags of [[], ['--json']]) {
        await main(['read', 'REQ-8', ...flags])
        expect(output()).toMatchObject({ cacheReused: true, contentOmitted: true, contentToken: current.contentToken,
          properties: { priority: 'high' }, latestRevision: { version: conditions.length } })
        expect(output()).not.toHaveProperty('contentJson')
        expect(output().contentHint).toContain('--full')
        expect(Buffer.byteLength(log.mock.calls.at(-1)![0])).toBeLessThan(fullBytes / 10)
      }
      await main(['snapshot', 'REQ-8'])
      expect(output()).toMatchObject({ contentOmitted: true, id: 'snap_abcdefghijklmnop', requirementId: current.id,
        baseRevisionId: 'rev_latest', lock: { expiresAt: '2026-10-04T12:30:00.000Z' } })
      expect(output()).not.toHaveProperty('contentJson')
      for (const command of ['read', 'snapshot']) {
        await main([command, 'REQ-8', '--full'])
        expect(output()).toMatchObject({ cacheReused: true, contentJson: current.contentJson, latestRevision: { version: conditions.length } })
        expect(output()).not.toHaveProperty('contentOmitted')
        const out = join(root, `${command}.json`)
        await main([command, 'REQ-8', '--out', out])
        expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({ cacheReused: true, contentJson: current.contentJson, latestRevision: { version: conditions.length } })
        expect(log.mock.calls.at(-1)![0]).not.toContain('需要保留')
      }
      expect(conditions[0]).toBeNull()
      expect(conditions.slice(1).every(condition => condition === current.contentToken)).toBe(true)
      current = { ...current, contentToken: `3:${'b'.repeat(64)}`, contentJson: document([paragraph('long', '实际变动后的正文')]) }
      await main(['read', 'REQ-8'])
      expect(output()).toMatchObject({ notModified: false, contentJson: current.contentJson })
      expect(output()).not.toHaveProperty('contentOmitted')
      await expect(main(['status', 'REQ-8', '--full'])).rejects.toThrow('--full 仅用于 read/snapshot')
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
  })

  it('上传真实本地文件，重试复用上传 ID，multipart 不手写 Content-Type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rb-tools-upload-'))
    const file = join(root, '截图.png')
    vi.stubEnv('RB_BASE_URL', origin); vi.stubEnv('RB_TOKEN', token)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ url: '/uploads/asset_example.png' })))
    try {
      await writeFile(file, Buffer.from([1, 2, 3]))
      await main(['upload-image', 'REQ-8', '--file', file])
      await main(['upload-image', 'REQ-8', '--file', file])
      expect(String(fetch.mock.calls[0]![0])).toBe(String(fetch.mock.calls[1]![0]))
      const options = fetch.mock.calls[0]![1]!
      expect(options.headers).not.toHaveProperty('content-type')
      const multipart = options.body as FormData
      expect(Array.from(new Uint8Array(await (multipart.get('file') as Blob).arrayBuffer()))).toEqual([1, 2, 3])
      await main(['upload-image', '--create-request', 'request_abcdefghijkl', '--file', file])
      expect(String(fetch.mock.calls[2]![0])).toContain('createRequestId=request_abcdefghijkl')
      await expect(main(['upload-image', 'REQ-8', '--create-request', 'request_abcdefghijkl', '--file', file])).rejects.toThrow('不能同时')
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
  })

  it('Diff保留标题、章节、纯格式、图片尺寸与表格单元格变化，默认输出可读差异', () => {
    const heading: RichTextNode = { type: 'heading', attrs: { diffId: 'h', level: 2 }, content: [{ type: 'text', text: '验收标准' }] }
    const picture = (width: number): RichTextNode => ({ type: 'image', attrs: { diffId: 'i', src: '/uploads/sample.png', align: 'center', width }, content: [{ type: 'imageCaption' }] })
    const table = (text: string): RichTextNode => ({ type: 'table', attrs: { diffId: 't' }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('cell', text)] }] }] })
    const base = { title: '旧标题', contentJson: document([heading, paragraph('p', '重点'), picture(100), table('旧值')]) }
    const target = { title: '新标题', contentJson: document([heading, paragraph('p', '重点', [{ type: 'bold' }]), picture(200), table('新值')]) }
    const diff = agentDiff(base, target)
    expect(diff.counts).toMatchObject({ unchanged: 1, modified: 3 })
    expect(diff.blocks[0]).toMatchObject({ section: ['验收标准'], formatChanges: [{ text: '重点', before: [], after: [{ type: 'bold' }] }] })
    expect(diff.blocks[1]).toMatchObject({ attributesChanged: true, before: { node: { attrs: { width: 100 } } }, after: { node: { attrs: { width: 200 } } } })
    expect(diff.blocks[2]!.cells![0]).toMatchObject({ row: 1, column: 1, status: 'modified' })
    const output = formatDiff({ ...diff, key: 'REQ-8', base: { id: 'rev_one', version: 1 }, target: { id: 'draft' }, nextOffset: null })
    for (const text of ['v1 → 当前草稿', '验收标准', '- 旧标题', '+ 新标题', '格式', 'bold', '100', '200', '单元格 1,1', '旧值', '新值']) expect(output).toContain(text)
    expect(formatLog([{ version: 1, id: 'rev_one', author: { name: '保存者' }, createdAt: '2026-10-04', changeNote: '说明' }])).toContain('保存人：保存者')
    expect(formatHistory({ key: 'REQ-8', note: '边界说明', status: 'ambiguous', matchCount: 2, matches: [{ blockId: 'p', start: 1, text: '重点' }] })).toContain('--block 和 --start')
  })

  it.each([
    ['introduced', 'lost', '追溯到此中断', '无法可靠对应到更早版本'],
    ['tracking_lost', 'lost', '追溯到此中断', '不能据此确认首次出现'],
    ['introduced', 'exact', '最早可查记录', '保存人和保存时间不能证明'],
    ['history_boundary', 'exact', '达到历史查询上限', '更早版本未纳入查询'],
  ])('历史 %s/%s 解释记录边界，不把未知前文渲染为确定新增', (status, confidence, label, explanation) => {
    const output = formatHistory({ key: 'REQ-8', status: 'found', entries: [{ version: 3, status, confidence,
      savedBy: '保存者', savedAt: '2026-10-04', changeNote: '补充示例',
      segments: [{ status, confidence, before: '', after: '验收示例', afterChunks: [], participants: [{ name: '参与者' }] }],
    }] })
    expect(output).toContain(`v3  ${label}`)
    expect(output).toContain(explanation)
    expect(output).toContain('此版本文本：\n验收示例')
    expect(output).toContain('节点参与者：参与者')
    expect(output).not.toContain('+ 验收示例')
    expect(output).not.toContain('introduced')
    expect(output).not.toContain('定位：lost')
  })

  it('可对应的历史仍显示前后变化，并明确推断定位', () => {
    const output = formatHistory({ key: 'REQ-8', status: 'found', entries: [{ version: 2, status: 'modified', confidence: 'inferred',
      segments: [{ status: 'modified', confidence: 'inferred', before: '旧文', after: '新文', afterChunks: [], participants: [] }],
    }] })
    expect(output).toContain('推断定位')
    expect(output).toContain('结合上下文核对')
    expect(output).toContain('- 旧文\n+ 新文')
  })

  it('查询文本中的 -t 和 --stat 被保留为数据，不触发命令开关', async () => {
    vi.stubEnv('RB_BASE_URL', origin); vi.stubEnv('RB_TOKEN', token)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    try {
      for (const text of ['-t', '--stat', '--full', '- 列表项']) {
        await main(['history', 'REQ-8', '--text', text, '--json'])
        expect(new URL(String(fetch.mock.calls.at(-1)![0])).searchParams.get('text')).toBe(text)
      }
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs() }
  })

})
