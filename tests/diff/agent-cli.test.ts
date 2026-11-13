import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { configuration, main, request, requirementId } from '../../skills/requirement-board/scripts/rb.mjs'

const token = `rb_agent_${'a'.repeat(43)}`
describe('Skill 命令行', () => {
  it('不把凭证发送到跨站链接、明文公网或重定向目标', async () => {
    expect(() => configuration({ RB_BASE_URL: 'http://example.com', RB_TOKEN: token })).toThrow('HTTPS')
    expect(() => configuration({ RB_BASE_URL: 'https://example.com/path', RB_TOKEN: token })).toThrow('origin')
    expect(() => requirementId('https://evil.example/requirements/req_123', 'https://board.example')).toThrow('配置的站点')
    expect(requirementId('https://board.example/requirements/req_123?view=edit', 'https://board.example')).toBe('req_123')
    let redirected = false
    const server = createServer((req, res) => {
      if (req.url === '/api/agent/v1/schema') { res.writeHead(302, { location: '/credential-leak' }); res.end() }
      else { redirected = true; res.end('{}') }
    }).listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const port = (server.address() as { port: number }).port
      await expect(request({ origin: `http://127.0.0.1:${port}`, token }, 'schema')).rejects.toThrow()
      expect(redirected).toBe(false)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('new 分配一次 requestId，不覆盖已有建议，文件无需凭证即可准备', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-cli-test-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { writeFile } = await import('node:fs/promises')
    try {
      const snapshot = join(dir, 'snapshot.json'), proposal = join(dir, 'proposal.json')
      await writeFile(snapshot, JSON.stringify({ id: 'snap_abcdefghijklmnop', schemaVersion: 3 }))
      await main(['new', '--snapshot', snapshot, '--out', proposal])
      const created = JSON.parse(await readFile(proposal, 'utf8'))
      expect(created.snapshotId).toBe('snap_abcdefghijklmnop')
      expect(created.requestId).toMatch(/^[0-9a-f-]{36}$/)
      await expect(main(['new', '--snapshot', snapshot, '--out', proposal])).rejects.toThrow()
      expect(JSON.parse(await readFile(proposal, 'utf8')).requestId).toBe(created.requestId)
      expect(log.mock.calls.flat().join('')).not.toContain(token)
    } finally { log.mockRestore(); await rm(dir, { recursive: true, force: true }) }
  })

  it('默认调用直接执行接口；旧接管参数等价，命令不自动要求保存版本', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-cli-mode-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('RB_BASE_URL', 'https://board.example')
    vi.stubEnv('RB_TOKEN', token)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ id: 'suggestion_abcdefghijklmnop', status: 'applied', documentUrl: '/requirements/req_123' })))
    try {
      const file = join(dir, 'action.json')
      const payload = { requestId: 'request_abcdefghijkl', operations: [] }
      await writeFile(file, JSON.stringify(payload))
      await main(['submit', '--file', file])
      await main(['submit', '--file', file, '-t'])
      await main(['--takeover', 'submit', '--file', file])
      await main(['submit', '--file', file])
      expect(fetch.mock.calls.map(call => (call[0] as URL).pathname)).toEqual(Array(4).fill('/api/agent/v1/operations'))
      expect(fetch.mock.calls.map(call => (call[1]?.headers as Record<string, string>)['x-rb-mode'])).toEqual(Array(4).fill(undefined))
      for (const call of fetch.mock.calls) expect(JSON.parse(String(call[1]?.body))).toEqual(payload)
      expect(log.mock.calls.flat().join('')).toContain('https://board.example/requirements/req_123')
      await expect(main(['read', 'REQ-1', '-t'])).rejects.toThrow('仅用于 submit')
      await expect(main(['submit', '--file', file, '-d'])).rejects.toThrow('未知参数')
      expect(fetch).toHaveBeenCalledTimes(4)
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) }
  })

  it('新建模板与只读查询提供完整管理入口，读取不调用 snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rb-cli-create-'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('RB_BASE_URL', 'https://board.example'); vi.stubEnv('RB_TOKEN', token)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    try {
      const file = join(dir, 'create.json')
      await main(['new', '--create', '--out', file])
      const input = JSON.parse(await readFile(file, 'utf8'))
      expect(input).toMatchObject({ action: 'create', properties: {}, contentJson: { type: 'doc' } })
      expect(fetch).not.toHaveBeenCalled()
      await expect(main(['new', '--create', '--out', file])).rejects.toThrow()
      await main(['read', 'REQ-12'])
      await main(['meta'])
      expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(['https://board.example/api/agent/v1/requirements/REQ-12',
        'https://board.example/api/agent/v1/meta'])
      expect(fetch.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true)
    } finally { fetch.mockRestore(); log.mockRestore(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }) }
  })
})
