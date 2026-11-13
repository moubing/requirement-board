import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { install, installerOptions, uninstall, update } from '../../skills/requirement-board/install.mjs'
import { unpackSkillArchive } from '../../skills/requirement-board/scripts/archive.mjs'
import { skillArchive } from '../../server/utils/skill-archive'
import { openInstallTerminal, windowsTerminalScript } from '../../skills/requirement-board/scripts/terminal.mjs'
import { agentSetupGuide } from '../../server/utils/agent-setup-guide'
import { codexPaths, loadConfiguration } from '../../skills/requirement-board/scripts/config.mjs'
import { prompt, SetupCancelled } from '../../skills/requirement-board/scripts/prompt.mjs'
import { skillFiles } from '../../skills/requirement-board/scripts/files.mjs'

const token = `rb_agent_${'a'.repeat(43)}`
const roots: string[] = []
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'rb-installer-test-'))
  roots.push(root)
  return { root, env: { CODEX_HOME: join(root, 'codex') } }
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('rb-installer-test-')) throw new Error('Invalid test cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})
function answers(...values: string[]) {
  return vi.fn(async (_message: string, _options?: unknown) => {
    if (!values.length) throw new Error('Unexpected prompt')
    return values.shift()!
  })
}
async function serverFixture(status = 200, archive?: Buffer, downloadStatus = 200) {
  const seen: { url?: string; authorization?: string }[] = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization })
    if (req.url === '/api/agent/skill') {
      res.writeHead(downloadStatus, { 'content-type': 'application/gzip', ...(downloadStatus === 302 ? { location: 'https://other.example/skill' } : {}) })
      res.end(archive ?? 'invalid archive')
      return
    }
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(status === 200 ? { schemaVersion: 3, nodes: { doc: {} }, marks: {} } : { message: 'expired' }))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
async function bundle(extra: { path: string; content: Buffer }[] = []) {
  return skillArchive([...await Promise.all(skillFiles.map(async path => ({ path, content: await readFile(resolve('skills/requirement-board', path)) }))), ...extra])
}
function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false,
    setRawMode(value: boolean) { this.isRaw = value; return this } })
  const output = Object.assign(new PassThrough(), { isTTY: true })
  let text = ''
  output.on('data', chunk => { text += chunk.toString() })
  return { input, output, text: () => text }
}

describe('Codex Skill 安装向导', () => {
  it('安装链接仅包含本站公开入口，拒绝能破坏命令示例的域名', () => {
    const guide = agentSetupGuide('https://board.example')
    expect(guide).toContain('https://board.example/api/agent/skill')
    expect(guide).toContain("--open-terminal --base-url 'https://board.example'")
    expect(guide).toContain('不要读取或打印配置文件里的 Token')
    expect(guide).not.toContain('rb_agent_')
    expect(() => agentSetupGuide("https://bad'host.example")).toThrow('域名')
    expect(() => agentSetupGuide('http://board.example')).toThrow('HTTPS')
    expect(() => agentSetupGuide('https://board.example/?token=secret')).toThrow('origin')
  })

  it('链接带入 URL 后只提示 Token，不沿用另一个站点的凭证', async () => {
    const f = await temporary(), server = await serverFixture(), paths = codexPaths(f.env)
    try {
      await mkdir(paths.settings, { recursive: true })
      await writeFile(paths.config, JSON.stringify({ version: 1, RB_BASE_URL: 'https://old.example', RB_TOKEN: token }))
      const ask = answers('', token)
      await install({ env: f.env, baseUrl: server.origin, ask, log: vi.fn() })
      expect(ask.mock.calls.map(call => call[0]).every(message => message.startsWith('Token'))).toBe(true)
      expect(ask).toHaveBeenCalledTimes(2)
      expect(await loadConfiguration(f.env)).toEqual({ origin: 'https://old.example', token })
      expect(await loadConfiguration(f.env, server.origin)).toEqual({ origin: server.origin, token })
      expect(server.seen).toHaveLength(1)
    } finally { await server.close() }
  })

  it('终端参数不接受 Token，等待窗口结果并保留失败或取消状态', async () => {
    expect(installerOptions(['--open-terminal', '--base-url', 'https://board.example'])).toMatchObject({ openTerminal: true, baseUrl: 'https://board.example' })
    expect(() => installerOptions(['--token', token])).toThrow('Token 必须在终端输入')
    expect(() => installerOptions(['--token', token])).not.toThrow(token)
    expect(() => installerOptions(['--open-terminal', '--terminal-child'])).toThrow('不能同时')
    const run = vi.fn(async () => ({ stdout: '', stderr: '' }))
    const options = { platform: 'win32', installerPath: "C:\\临时目录 & '文字\\install.mjs", baseUrl: 'https://board.example', run }
    expect(await openInstallTerminal(options)).toBe(0)
    const args = run.mock.calls[0] as unknown as [string, string[], { windowsHide: boolean }]
    const script = Buffer.from(args[1].at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('-WindowStyle Normal -PassThru -Wait')
    expect(script).toContain('"install" "--terminal-child" "--base-url" "https://board.example"')
    expect(script).not.toContain('--local-ports')
    expect(script).not.toContain('RedirectStandard')
    expect(args[2].windowsHide).toBe(true)
    expect(await openInstallTerminal({ ...options, run: async () => { throw { code: 130 } } })).toBe(130)
    await expect(openInstallTerminal({ ...options, platform: 'linux' })).rejects.toThrow('用户可直接输入的终端')
  })

  it.skipIf(process.platform !== 'win32')('Windows 原生命令能完整传递空格、中文和引号路径（测试窗口隐藏）', async () => {
    const f = await temporary()
    const capture = join(f.root, "带空格 & '引号", 'capture.mjs')
    const output = join(f.root, 'arguments.json')
    await mkdir(dirname(capture), { recursive: true })
    await writeFile(capture, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({ args: process.argv.slice(2), input: process.stdin.isTTY, output: process.stdout.isTTY }))`)
    // 原生 argv 用完整参数集验证一次；默认安装参数已在上面的无进程用例中检查。
    const localScript = windowsTerminalScript(process.execPath, capture, 'http://localhost:3000', 'configure', true).replace('-WindowStyle Normal', '-WindowStyle Hidden')
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(localScript, 'utf16le').toString('base64')], { windowsHide: true })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ args: ['configure', '--terminal-child', '--base-url', 'http://localhost:3000', '--local-ports'], input: true, output: true })
  })

  it('使用用户目录，已配置 CODEX_HOME 时遵循该目录', () => {
    expect(codexPaths({}).skill).toBe(join(homedir(), '.codex', 'skills', 'requirement-board'))
    expect(codexPaths({ CODEX_HOME: './custom-codex' }).root).toBe(resolve('custom-codex'))
  })

  it('隐藏凭证输入、支持退格，结束后恢复终端状态', async () => {
    const tty = terminal()
    const pending = prompt('Token', { hidden: true, ...tty })
    tty.input.write(`${token}x\u007f\r`)
    expect(await pending).toBe(token)
    expect(tty.text()).not.toContain(token)
    expect(tty.text()).toContain('*')
    expect(tty.input.isRaw).toBe(false)
    expect(tty.input.isPaused()).toBe(true)
    expect(tty.input.listenerCount('keypress')).toBe(0)
  })

  it('默认 URL 可直接回车，Ctrl+C 取消时清理终端，不接收管道凭证', async () => {
    const tty = terminal()
    const first = prompt('URL', { defaultValue: 'http://localhost:3000', ...tty })
    tty.input.write('\r')
    expect(await first).toBe('http://localhost:3000')
    const cancelled = prompt('Token', { hidden: true, ...tty })
    tty.input.write('\u0003')
    await expect(cancelled).rejects.toBeInstanceOf(SetupCancelled)
    expect(tty.input.isRaw).toBe(false)
    expect(tty.input.listenerCount('keypress')).toBe(0)
    expect(() => prompt('Token', { input: new PassThrough(), output: tty.output })).toThrow('交互式终端')
  })

  it('安装后从本机配置运行真实 CLI，无需环境变量；Token 不进入 Skill 文件或输出', async () => {
    const f = await temporary(), server = await serverFixture(), log = vi.fn()
    try {
      const ask = answers('http://public.example', server.origin, 'invalid', token)
      const result = await install({ env: f.env, ask, log })
      expect(ask).toHaveBeenCalledTimes(4)
      expect(server.seen).toEqual([{ url: '/api/agent/v1/schema', authorization: `Bearer ${token}` }])
      expect(await loadConfiguration(f.env)).toEqual({ origin: server.origin, token })
      for (const file of skillFiles) {
        const content = await readFile(join(result.skill, file), 'utf8')
        expect(content).not.toContain(token)
      }
      const env = { ...process.env, ...f.env }
      delete env.RB_BASE_URL; delete env.RB_TOKEN
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [join(result.skill, 'scripts/rb.mjs'), 'schema'], { env, windowsHide: true })
      expect(JSON.parse(stdout).schemaVersion).toBe(3)
      expect(stderr).toBe('')
      expect(log.mock.calls.flat().join('\n') + stdout + stderr).not.toContain(token)
      if (process.platform !== 'win32') expect((await stat(result.config)).mode & 0o777).toBe(0o600)
    } finally { await server.close() }
  })

  it('配置来源必须成对，不能将本机 Token 发送给环境变量指定的其他站点', async () => {
    const f = await temporary(), paths = codexPaths(f.env)
    await mkdir(paths.settings, { recursive: true })
    await writeFile(paths.config, JSON.stringify({ version: 1, RB_BASE_URL: 'https://board.example', RB_TOKEN: token }))
    await expect(loadConfiguration({ ...f.env, RB_BASE_URL: 'https://other.example' })).rejects.toThrow('同时配置')
    await expect(loadConfiguration({ ...f.env, RB_TOKEN: token })).rejects.toThrow('同时配置')
    expect(await loadConfiguration({ ...f.env, RB_BASE_URL: 'https://other.example', RB_TOKEN: token })).toEqual({ origin: 'https://other.example', token })
    await writeFile(paths.config, `invalid ${token}`)
    await expect(loadConfiguration(f.env)).rejects.toThrow('本机配置无效')
    await expect(loadConfiguration(f.env)).rejects.not.toThrow(token)
  })

  it('重复安装不提问、不重写配置；备份自定义内容，重新配置取消不改变安装', async () => {
    const f = await temporary(), server = await serverFixture(), log = vi.fn()
    try {
      const first = await install({ env: f.env, ask: answers(server.origin, token), log })
      await writeFile(join(first.skill, 'notes.md'), '用户自定义说明')
      const original = await readFile(first.config, 'utf8')
      await expect(install({ env: f.env, reconfigure: true, ask: async () => { throw new SetupCancelled() }, log })).rejects.toBeInstanceOf(SetupCancelled)
      expect(await readFile(first.config, 'utf8')).toBe(original)
      const ask = answers()
      const before = await stat(first.config)
      const second = await install({ env: f.env, ask, log })
      expect(ask).not.toHaveBeenCalled()
      expect(second.backup).toBeTruthy()
      expect(await readFile(join(second.backup!, 'notes.md'), 'utf8')).toBe('用户自定义说明')
      expect(await readFile(second.config, 'utf8')).toBe(original)
      expect((await stat(second.config)).mtimeMs).toBe(before.mtimeMs)
      await install({ env: f.env, source: second.skill, ask, log })
      expect(ask).not.toHaveBeenCalled()
      expect(server.seen).toHaveLength(1)
      expect(await readdir(join(codexPaths(f.env).settings, 'backups'))).toHaveLength(1)
    } finally { await server.close() }
  })

  it('验证失败后取消，不安装、不覆盖已保存的配置', async () => {
    const f = await temporary(), server = await serverFixture(401), paths = codexPaths(f.env)
    await mkdir(paths.settings, { recursive: true })
    const original = JSON.stringify({ version: 1, RB_BASE_URL: server.origin, RB_TOKEN: token })
    await writeFile(paths.config, original)
    let attempts = 0
    const ask = async () => {
      if (++attempts === 1) return server.origin
      if (attempts === 2) return token
      throw new SetupCancelled()
    }
    try {
      await expect(install({ env: f.env, reconfigure: true, ask, log: vi.fn() })).rejects.toBeInstanceOf(SetupCancelled)
      expect(await readFile(paths.config, 'utf8')).toBe(original)
      await expect(access(paths.skill)).rejects.toThrow()
      expect(server.seen).toHaveLength(1)
    } finally { await server.close() }
  })

  it('切换站点时不能沿用旧凭证，配置写入失败会恢复旧 Skill', async () => {
    const f = await temporary(), server = await serverFixture(), paths = codexPaths(f.env), log = vi.fn()
    try {
      await mkdir(paths.settings, { recursive: true })
      await writeFile(paths.config, JSON.stringify({ version: 1, RB_BASE_URL: 'https://old.example', RB_TOKEN: token }))
      const ask = answers(server.origin, '', token)
      await install({ env: f.env, reconfigure: true, ask, log })
      expect(ask).toHaveBeenCalledTimes(3)
      await writeFile(join(paths.skill, 'notes.md'), '保留旧文件')
      await rm(paths.config)
      await mkdir(paths.config)
      await expect(install({ env: f.env, ask: answers(server.origin, token), log })).rejects.toThrow()
      expect(await readFile(join(paths.skill, 'notes.md'), 'utf8')).toBe('保留旧文件')
      expect((await readdir(paths.skills)).filter(name => name.startsWith('.requirement-board-install-'))).toHaveLength(0)
    } finally { await server.close() }
  })

  it('实际更新命令自动下载新版、不带凭证；新增文件完整安装，过期 Token 也可复用', async () => {
    const f = await temporary(), archive = await bundle([{ path: 'scripts/new-feature.mjs', content: Buffer.from('export const upgraded = true') }])
    const server = await serverFixture(401, archive), paths = codexPaths(f.env), log = vi.fn()
    try {
      await mkdir(paths.settings, { recursive: true })
      const original = JSON.stringify({ version: 1, RB_BASE_URL: server.origin, RB_TOKEN: token })
      await writeFile(paths.config, original)
      await install({ env: f.env, ask: answers(), log })
      await writeFile(join(paths.skill, 'notes.md'), '自定义写作习惯')
      const before = await stat(paths.config)
      const env = { ...process.env, ...f.env }; delete env.RB_BASE_URL; delete env.RB_TOKEN
      const { stdout, stderr } = await promisify(execFile)(process.execPath, [join(paths.skill, 'install.mjs'), 'update'], { env, windowsHide: true, timeout: 30_000 })
      expect(server.seen).toEqual([{ url: '/api/agent/skill', authorization: undefined }])
      expect(await readFile(join(paths.skill, 'scripts/new-feature.mjs'), 'utf8')).toContain('upgraded')
      expect(await readFile(paths.config, 'utf8')).toBe(original)
      expect((await stat(paths.config)).mtimeMs).toBe(before.mtimeMs)
      const backups = await readdir(join(paths.settings, 'backups'))
      expect(await readFile(join(paths.settings, 'backups', backups[0]!, 'notes.md'), 'utf8')).toBe('自定义写作习惯')
      expect(stdout).toContain('Skill 已更新')
      expect(stdout + stderr).not.toContain(token)
    } finally { await server.close() }
  })

  it('独立安装包能无交互升级旧 Skill；卸载后重装复用配置，清除配置是独立选项', async () => {
    const f = await temporary(), paths = codexPaths(f.env), server = await serverFixture(), log = vi.fn()
    try {
      await install({ env: f.env, ask: answers(server.origin, token), log })
      const original = await readFile(paths.config, 'utf8')
      await writeFile(join(paths.skill, 'install.mjs'), '// 模拟没有 update 命令的旧版本')
      await update({ env: f.env, fromBundle: true, baseUrl: server.origin, log })
      expect(await readFile(join(paths.skill, 'install.mjs'), 'utf8')).toContain('export async function update')
      const env = { ...process.env, ...f.env }; delete env.RB_BASE_URL; delete env.RB_TOKEN
      const removed = await promisify(execFile)(process.execPath, [join(paths.skill, 'install.mjs'), 'uninstall'], { env, windowsHide: true })
      expect(removed.stdout).toContain('Skill 已卸载')
      await expect(access(paths.skill)).rejects.toThrow()
      expect(await readFile(paths.config, 'utf8')).toBe(original)
      const ask = answers()
      await install({ env: f.env, baseUrl: server.origin, ask, log })
      expect(ask).not.toHaveBeenCalled()
      await mkdir(join(paths.skills, 'other-skill'))
      await writeFile(join(paths.settings, 'keep.txt'), '保留其他本机文件')
      await uninstall({ env: f.env, purgeConfig: true, log })
      await expect(access(paths.config)).rejects.toThrow()
      await expect(access(paths.skill)).rejects.toThrow()
      await access(join(paths.skills, 'other-skill'))
      expect(await readFile(join(paths.settings, 'keep.txt'), 'utf8')).toBe('保留其他本机文件')
      await expect(uninstall({ env: f.env, purgeConfig: true, log })).resolves.toBeDefined()
    } finally { await server.close() }
  })

  it('AI 无交互安装复用配置；缺少配置返回明确状态，不能从管道读取 Token', async () => {
    const f = await temporary(), server = await serverFixture(), paths = codexPaths(f.env)
    const env = { ...process.env, ...f.env }; delete env.RB_BASE_URL; delete env.RB_TOKEN
    const run = promisify(execFile)
    const script = resolve('skills/requirement-board/install.mjs')
    try {
      await expect(run(process.execPath, [script, '--non-interactive', '--base-url', server.origin], { env, windowsHide: true })).rejects.toMatchObject({ code: 2 })
      await expect(access(paths.skill)).rejects.toThrow()
      await install({ env: f.env, ask: answers(server.origin, token), log: vi.fn() })
      // --open-terminal 在可复用配置时也不启动窗口；在非 Windows 上同样可完成。
      expect((await run(process.execPath, [script, '--open-terminal', '--base-url', server.origin], { env, windowsHide: true })).stdout).toContain('已复用')
      expect(server.seen).toHaveLength(1)
    } finally { await server.close() }
  })

  it('下载失败、包损坏、跨站更新均保留旧文件与配置；不跟随重定向', async () => {
    const f = await temporary(), paths = codexPaths(f.env), log = vi.fn()
    for (const downloadStatus of [200, 302, 503]) {
      const server = await serverFixture(200, Buffer.from('损坏的下载包'), downloadStatus)
      try {
        await install({ env: f.env, baseUrl: server.origin, ask: answers(token), log })
        await writeFile(join(paths.skill, 'notes.md'), '不能丢失')
        const original = await readFile(paths.config, 'utf8')
        await expect(update({ env: f.env, baseUrl: 'https://other.example', log })).rejects.toThrow('站点不同')
        await expect(update({ env: f.env, baseUrl: server.origin, log })).rejects.toThrow()
        expect(await readFile(join(paths.skill, 'notes.md'), 'utf8')).toBe('不能丢失')
        expect(await readFile(paths.config, 'utf8')).toBe(original)
        expect(server.seen.filter(request => request.url === '/api/agent/skill')).toEqual([{ url: '/api/agent/skill', authorization: undefined }])
        expect((await readdir(paths.skills)).filter(name => name.startsWith('.requirement-board-install-'))).toHaveLength(0)
      } finally { await server.close() }
    }
  })

  it('拒绝越界路径、链接、重复文件及校验损坏的压缩包', async () => {
    const archive = await bundle()
    expect(unpackSkillArchive(archive).map(file => file.path)).toEqual(skillFiles)
    for (const change of [
      (tar: Buffer) => { tar.fill(0, 0, 100); tar.write('requirement-board/../outside.txt', 0) },
      (tar: Buffer) => { tar[156] = '2'.charCodeAt(0) },
      (tar: Buffer) => { tar.fill(0, 0, 100); tar.write('requirement-board/C:/outside.txt', 0) },
      (tar: Buffer) => { tar.fill(0, 0, 100); tar.write('requirement-board/config.json', 0) },
    ]) {
      const tar = gunzipSync(archive); change(tar); tar.fill(32, 148, 156)
      tar.write(tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
      expect(() => unpackSkillArchive(gzipSync(tar))).toThrow('下载包无效')
    }
    expect(() => unpackSkillArchive(skillArchive([{ path: 'SKILL.md', content: Buffer.from('name: requirement-board') }]))).toThrow()
    expect(() => unpackSkillArchive(gzipSync(gunzipSync(archive).subarray(0, -1024)))).toThrow()
    expect(() => unpackSkillArchive(skillArchive([{ path: 'same.txt', content: Buffer.alloc(0) }, { path: 'same.txt', content: Buffer.alloc(0) }]))).toThrow()
  })

  it('卸载拒绝链接目录及同名的其他 Skill，不删除目录外文件', async () => {
    const f = await temporary(), paths = codexPaths(f.env), outside = join(f.root, 'outside'), log = vi.fn()
    await mkdir(paths.skills, { recursive: true }); await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), '外部文件')
    await symlink(outside, paths.skill, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(uninstall({ env: f.env, log })).rejects.toThrow('链接')
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('外部文件')
    await rm(paths.skill)
    await mkdir(paths.skill); await writeFile(join(paths.skill, 'SKILL.md'), 'name: other-skill')
    await expect(uninstall({ env: f.env, log })).rejects.toThrow('不是可识别')
    expect(await readFile(join(paths.skill, 'SKILL.md'), 'utf8')).toBe('name: other-skill')
  })
})
