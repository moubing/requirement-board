import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aliasSite, install, installerOptions, update } from '../../skills/requirement-board/install.mjs'
import { codexPaths, listSites, loadConfiguration, saveConfiguration, saveSiteAlias } from '../../skills/requirement-board/scripts/config.mjs'
import { main } from '../../skills/requirement-board/scripts/rb.mjs'
import { anchorSegment, extractAnnotationBlocks } from '../../shared/agent/annotations'
import { agentDocumentSchema } from '../../shared/agent/schema'

const production = { origin: 'https://production.example', token: `rb_agent_${'p'.repeat(43)}` }
const localToken = `rb_agent_${'l'.repeat(43)}`
const roots: string[] = [], closers: (() => Promise<void>)[] = []
const contentJson = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [{ type: 'text', text: '待修改正文' }] }] }
const document = { id: 'req_local', key: 'REQ-1', schemaVersion: 3, title: '本地文档', contentToken: `3:${'a'.repeat(64)}`, contentJson }
const snapshot = { ...document, id: 'snap_abcdefghijklmnop', requirementId: document.id }
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs()
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('rb-sites-test-')) throw new Error('Invalid test cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rb-sites-test-'))
  roots.push(root)
  const env = { CODEX_HOME: join(root, 'codex') }, paths = codexPaths(env)
  await mkdir(paths.settings, { recursive: true })
  const original = JSON.stringify({ version: 1, RB_BASE_URL: production.origin, RB_TOKEN: production.token })
  await writeFile(paths.config, original)
  vi.stubEnv('CODEX_HOME', env.CODEX_HOME)
  vi.stubEnv('RB_BASE_URL', undefined); vi.stubEnv('RB_TOKEN', undefined)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  return { root, env, paths, original, log }
}

async function serverFixture(status = 200) {
  const seen: { path: string; authorization?: string; body?: Record<string, unknown> }[] = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString()
    const path = req.url!.split('?')[0]!
    seen.push({ path, authorization: req.headers.authorization, ...(text ? { body: JSON.parse(text) } : {}) })
    const value = path.endsWith('/schema') ? agentDocumentSchema()
      : path === '/api/agent/v1/requirements' ? { items: [document], page: 1, pageSize: 20, total: 1, asOf: new Date().toISOString() }
      : path.includes('/related') ? []
      : path.endsWith('/snapshot') ? { ...snapshot, siteOrigin: 'https://forged.example' }
        : path.endsWith('/operations/validate') ? { valid: true, schemaVersion: 3 }
          : path.endsWith('/operations') ? { status: 'applied', document, documentUrl: '/requirements/req_local' }
            : document
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  closers.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen }
}

describe('Skill 多站点配置与本地端口', () => {
  it('读取旧配置不迁移文件，新增/更新本地凭证保留生产默认值，sites 不暴露凭证', async () => {
    const f = await fixture(), local = { origin: 'http://localhost:3001', token: localToken }
    const before = await stat(f.paths.config)
    expect(await loadConfiguration(f.env)).toEqual(production)
    await main(['sites'])
    expect(await readFile(f.paths.config, 'utf8')).toBe(f.original)
    expect((await stat(f.paths.config)).mtimeMs).toBe(before.mtimeMs)
    await saveConfiguration(local, f.env)
    expect(await loadConfiguration(f.env)).toEqual(production)
    expect(await loadConfiguration(f.env, local.origin)).toEqual(local)
    const nextToken = `rb_agent_${'n'.repeat(43)}`
    await saveConfiguration({ ...local, token: nextToken }, f.env)
    expect(await loadConfiguration(f.env, local.origin)).toEqual({ ...local, token: nextToken })
    await main(['sites'])
    const output = f.log.mock.calls.at(-1)![0]
    expect(JSON.parse(output)).toEqual({ defaultOrigin: production.origin, sites: [{ origin: production.origin, aliases: [] }, { origin: local.origin, aliases: [] }] })
    for (const token of [production.token, localToken, nextToken]) expect(output).not.toContain(token)
  })

  it('并发添加不会丢配置；别名只能复用本地凭证且不覆盖独立配置', async () => {
    const f = await fixture()
    const local = { origin: 'http://localhost:3001', token: localToken }
    await Promise.all([saveConfiguration(local, f.env), saveConfiguration({ origin: 'https://staging.example', token: production.token }, f.env)])
    expect((await listSites(f.env)).sites).toHaveLength(3)
    await saveSiteAlias(local.origin, 'http://localhost:3002', f.env)
    expect(await loadConfiguration(f.env, 'http://localhost:3002')).toEqual({ ...local, origin: 'http://localhost:3002' })
    const original = await readFile(f.paths.config, 'utf8')
    await expect(saveSiteAlias(production.origin, 'http://localhost:3003', f.env)).rejects.toThrow('回环')
    await expect(saveSiteAlias(local.origin, production.origin, f.env)).rejects.toThrow('回环')
    await saveSiteAlias('http://localhost:3002', local.origin, f.env)
    expect(await readFile(f.paths.config, 'utf8')).toBe(original)
    await saveConfiguration({ origin: 'http://localhost:3003', token: localToken }, f.env)
    await expect(saveSiteAlias(local.origin, 'http://localhost:3003', f.env)).rejects.toThrow('独立配置')
  })

  it('configure 仅添加配置，不替换已安装 Skill；同站点可无交互复用且更新保留整份配置', async () => {
    const f = await fixture(), local = await serverFixture()
    const ask = vi.fn(async () => localToken)
    await install({ env: f.env, log: f.log })
    await writeFile(join(f.paths.skill, 'notes.md'), '本机调试中的自定义内容')
    await install({ env: f.env, baseUrl: local.origin, reconfigure: true, ask, log: f.log })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(await readFile(join(f.paths.skill, 'notes.md'), 'utf8')).toBe('本机调试中的自定义内容')
    expect(await loadConfiguration(f.env)).toEqual(production)
    const original = await readFile(f.paths.config, 'utf8'), before = await stat(f.paths.config)
    await install({ env: f.env, source: f.paths.skill, baseUrl: local.origin, ask, log: f.log })
    await update({ env: f.env, fromBundle: true, baseUrl: local.origin, log: f.log })
    expect(await readFile(f.paths.config, 'utf8')).toBe(original)
    expect((await stat(f.paths.config)).mtimeMs).toBe(before.mtimeMs)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(local.seen).toEqual([{ path: '/api/agent/v1/schema', authorization: `Bearer ${localToken}` }])
  })

  it('关联端口先验证本地凭证，失败或已有独立配置不保存关联、不借用生产凭证', async () => {
    const f = await fixture(), source = await serverFixture(), target = await serverFixture(), denied = await serverFixture(401)
    await saveConfiguration({ origin: source.origin, token: localToken }, f.env)
    await aliasSite({ env: f.env, from: source.origin, baseUrl: target.origin, log: f.log })
    expect(target.seen).toEqual([{ path: '/api/agent/v1/schema', authorization: `Bearer ${localToken}` }])
    expect(await loadConfiguration(f.env, target.origin)).toEqual({ origin: target.origin, token: localToken })
    await main(['status', `${target.origin}/requirements/req_local`])
    expect(target.seen.at(-1)).toEqual({ path: '/api/agent/v1/requirements/req_local/status', authorization: `Bearer ${localToken}` })
    const original = await readFile(f.paths.config, 'utf8')
    await expect(aliasSite({ env: f.env, from: source.origin, baseUrl: denied.origin, log: f.log })).rejects.toThrow('验证失败')
    await expect(aliasSite({ env: f.env, from: production.origin, baseUrl: denied.origin, log: f.log })).rejects.toThrow('回环')
    expect(await readFile(f.paths.config, 'utf8')).toBe(original)
    await saveConfiguration({ origin: denied.origin, token: localToken }, f.env)
    await expect(aliasSite({ env: f.env, from: source.origin, baseUrl: denied.origin, log: f.log })).rejects.toThrow('独立配置')
    expect(denied.seen).toHaveLength(1)
    expect(installerOptions(['alias', '--from', source.origin, '--base-url', target.origin])).toMatchObject({ action: 'alias', from: source.origin, baseUrl: target.origin })
    expect(() => installerOptions(['alias', '--base-url', target.origin])).toThrow('用法')
  })

  it('一次配置本地通用凭证，随后任意回环端口按链接访问，不逐个写入别名', async () => {
    const f = await fixture(), source = await serverFixture(), first = await serverFixture(), second = await serverFixture()
    const ask = vi.fn(async () => localToken)
    await install({ env: f.env, baseUrl: source.origin, reconfigure: true, localPorts: true, ask, log: f.log })
    expect(ask).toHaveBeenCalledTimes(1)
    const original = await readFile(f.paths.config, 'utf8')
    for (const site of [first, second]) {
      await main(['status', `${site.origin}/requirements/req_local`])
      expect(site.seen).toEqual([{ path: '/api/agent/v1/requirements/req_local/status', authorization: `Bearer ${localToken}` }])
    }
    for (const origin of ['http://localhost:4567', 'http://127.0.0.1:4568', 'http://[::1]:4569', 'https://localhost:4570']) {
      expect(await loadConfiguration(f.env, origin)).toEqual({ origin, token: localToken })
    }
    expect(await loadConfiguration(f.env)).toEqual(production)
    expect(await readFile(f.paths.config, 'utf8')).toBe(original)
    await main(['sites'])
    expect(JSON.parse(f.log.mock.calls.at(-1)![0])).toEqual({ defaultOrigin: production.origin,
      sites: [{ origin: production.origin, aliases: [] }, { origin: source.origin, aliases: [], localPorts: true }] })
    expect(f.log.mock.calls.flat().join('')).not.toContain(localToken)
    expect(installerOptions(['configure', '--base-url', source.origin, '--local-ports', '--open-terminal']))
      .toMatchObject({ localPorts: true, openTerminal: true })
    expect(() => installerOptions(['update', '--local-ports'])).toThrow('仅用于 configure')
    expect(() => installerOptions(['configure', '--base-url', production.origin, '--local-ports'])).toThrow('回环')
  })

  it('本地通用配置必须显式开启且仅一份，精确站点/别名优先，远程站点和环境覆盖不借用凭证', async () => {
    const f = await fixture(), local = { origin: 'http://localhost:3000', token: localToken }
    await expect(loadConfiguration(f.env, local.origin)).rejects.toThrow('尚未配置')
    await saveConfiguration({ ...local, localPorts: true }, f.env)
    const independent = { origin: 'http://localhost:3009', token: `rb_agent_${'i'.repeat(43)}` }
    await saveConfiguration(independent, f.env)
    await saveSiteAlias(independent.origin, 'http://127.0.0.1:3009', f.env)
    expect(await loadConfiguration(f.env, independent.origin)).toEqual(independent)
    expect(await loadConfiguration(f.env, 'http://127.0.0.1:3009')).toEqual({ ...independent, origin: 'http://127.0.0.1:3009' })
    const original = await readFile(f.paths.config, 'utf8')
    await expect(saveConfiguration({ ...production, localPorts: true }, f.env)).rejects.toThrow('回环')
    await expect(saveConfiguration({ ...independent, localPorts: true }, f.env)).rejects.toThrow('已有本地端口通用配置')
    expect(await readFile(f.paths.config, 'utf8')).toBe(original)
    const fetch = vi.spyOn(globalThis, 'fetch')
    for (const origin of ['https://unknown.example', 'https://localhost.example', 'http://192.168.1.5:3001']) {
      await expect(main(['status', `${origin}/requirements/req_local`])).rejects.toThrow()
    }
    vi.stubEnv('RB_BASE_URL', local.origin); vi.stubEnv('RB_TOKEN', localToken)
    await expect(main(['status', 'http://localhost:3001/requirements/req_local'])).rejects.toThrow('环境变量不同')
    expect(fetch).not.toHaveBeenCalled()
    await saveConfiguration({ ...local, token: independent.token }, f.env)
    expect(await loadConfiguration(f.env, 'http://localhost:3010')).toEqual({ origin: 'http://localhost:3010', token: independent.token })
  })

  it('链接选择本地配置，快照与请求绑定目标，校验/提交/续锁/释放均不回退到生产站点', async () => {
    const f = await fixture(), local = await serverFixture()
    await saveConfiguration({ origin: local.origin, token: localToken }, f.env)
    const snapshotFile = join(f.root, 'snapshot.json'), actionFile = join(f.root, 'action.json')
    await main(['snapshot', `${local.origin}/requirements/req_local`, '--out', snapshotFile])
    expect(JSON.parse(await readFile(snapshotFile, 'utf8')).siteOrigin).toBe(local.origin)
    await main(['new', '--snapshot', snapshotFile, '--out', actionFile])
    const action = JSON.parse(await readFile(actionFile, 'utf8'))
    expect(action.siteOrigin).toBe(local.origin)
    await main(['validate', '--file', actionFile])
    await main(['submit', '--file', actionFile])
    await main(['renew', '--snapshot', snapshotFile])
    await main(['release', '--snapshot', snapshotFile])
    expect(local.seen.map(item => item.path)).toEqual(['/api/agent/v1/requirements/req_local/snapshot', '/api/agent/v1/operations/validate',
      '/api/agent/v1/operations', '/api/agent/v1/requirements/req_local/lock', '/api/agent/v1/requirements/req_local/lock'])
    expect(local.seen.every(item => item.authorization === `Bearer ${localToken}`)).toBe(true)
    const { siteOrigin: _, ...payload } = action
    expect(local.seen[1]!.body).toEqual(payload)
    expect(local.seen[2]!.body).toEqual(payload)
    await expect(main(['submit', '--file', actionFile, '--site', production.origin])).rejects.toThrow('不同站点')
    expect(local.seen).toHaveLength(5)
  })

  it('无链接命令可显式选择站点；未知站点和来源冲突在联网前拒绝', async () => {
    const f = await fixture(), local = await serverFixture()
    await saveConfiguration({ origin: local.origin, token: localToken }, f.env)
    const actionFile = join(f.root, 'create.json')
    await main(['new', '--create', '--site', local.origin, '--out', actionFile])
    expect(JSON.parse(await readFile(actionFile, 'utf8')).siteOrigin).toBe(local.origin)
    for (const command of [['schema'], ['meta'], ['list'], ['read', 'REQ-1'], ['status', 'REQ-1']]) await main([...command, '--site', local.origin])
    expect(local.seen).toHaveLength(6)
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(main(['read', 'https://unconfigured.example/requirements/req_local'])).rejects.toThrow('尚未配置')
    await expect(main(['read', `${local.origin}/requirements/req_local`, '--site', production.origin])).rejects.toThrow('不同站点')
    vi.stubEnv('RB_BASE_URL', production.origin); vi.stubEnv('RB_TOKEN', production.token)
    await expect(main(['read', `${local.origin}/requirements/req_local`])).rejects.toThrow('环境变量不同')
    vi.stubEnv('RB_TOKEN', undefined)
    await expect(main(['schema', '--site', local.origin])).rejects.toThrow('同时配置')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('关联中任一完整链接选择对应站点，全部引用必须同源且不借用默认生产凭证', async () => {
    const f = await fixture(), local = await serverFixture(), other = await serverFixture()
    await saveConfiguration({ origin: local.origin, token: localToken }, f.env)
    await saveConfiguration({ origin: other.origin, token: `rb_agent_${'o'.repeat(43)}` }, f.env)
    await main(['link', 'REQ-1', `${local.origin}/requirements/req_local`])
    expect(local.seen).toEqual([
      { path: '/api/agent/v1/schema', authorization: `Bearer ${localToken}` },
      { path: '/api/agent/v1/requirements/REQ-1/related', authorization: `Bearer ${localToken}`, body: { documentIds: ['req_local'] } },
    ])
    await expect(main(['link', `${local.origin}/requirements/req_source`, `${other.origin}/requirements/req_local`])).rejects.toThrow('不同站点')
    expect(local.seen).toHaveLength(2)
    expect(other.seen).toEqual([])
  })

  it('AI 标注按复制来源选择站点，拒绝与快照或 --site 冲突', async () => {
    const f = await fixture(), local = await serverFixture()
    await saveConfiguration({ origin: local.origin, token: localToken }, f.env)
    const snapshotFile = join(f.root, 'snapshot.json'), annotationFile = join(f.root, 'annotations.json'), actionFile = join(f.root, 'action.json')
    const block = extractAnnotationBlocks(contentJson)[0]!
    const annotation = { format: 'rb-annotations/v1', source: 'shared-draft', document: { id: document.id, key: document.key, title: document.title,
      origin: local.origin, url: `${local.origin}/requirements/${document.id}` }, contentToken: document.contentToken, createdAt: new Date().toISOString(), overall: '',
      annotations: [{ id: 'annotation1', quote: '待修改正文', section: '', comment: '补充说明', segments: [anchorSegment(block, 0, 5)] }] }
    await writeFile(snapshotFile, JSON.stringify({ ...snapshot, siteOrigin: local.origin }))
    await writeFile(annotationFile, JSON.stringify(annotation))
    await main(['annotations', '--snapshot', snapshotFile, '--file', annotationFile])
    expect(JSON.parse(f.log.mock.calls.at(-1)![0]).ready).toBe(true)
    await main(['new', '--snapshot', snapshotFile, '--annotations', annotationFile, '--out', actionFile])
    expect(JSON.parse(await readFile(actionFile, 'utf8')).siteOrigin).toBe(local.origin)
    await expect(main(['annotations', '--snapshot', snapshotFile, '--file', annotationFile, '--site', production.origin])).rejects.toThrow('不同站点')
    await writeFile(snapshotFile, JSON.stringify({ ...snapshot, siteOrigin: production.origin }))
    await expect(main(['annotations', '--snapshot', snapshotFile, '--file', annotationFile])).rejects.toThrow('不同站点')
    expect(local.seen.map(value => value.path)).toEqual(['/api/agent/v1/schema'])
  })
})
