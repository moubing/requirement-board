import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const run = promisify(execFile)
let windowsSidPromise

function windowsUserSid() {
  // 进程身份不随配置/缓存目录变化；并发调用共用查询，失败后允许重试。
  windowsSidPromise ??= run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
    .then(({ stdout }) => {
      const sid = /^"(?:[^"\r\n]|"")*","(S-1-\d+(?:-\d+)+)"$/.exec(stdout.trim())?.[1]
      if (!sid) throw new Error('无法确认当前 Windows 用户，未保存凭证。')
      return sid
    })
    .catch(error => { windowsSidPromise = undefined; throw error })
  return windowsSidPromise
}

export function codexPaths(env = process.env) {
  const root = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), '.codex')
  return { root, skills: join(root, 'skills'), skill: join(root, 'skills', 'requirement-board'),
    settings: join(root, 'requirement-board'), config: join(root, 'requirement-board', 'config.json') }
}

export function normalizeOrigin(value) {
  let base
  try { base = new URL(value) } catch { throw new Error('RB_BASE_URL 必须是有效的站点 URL。') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('RB_BASE_URL 必须是 HTTPS 站点 origin（本机回环地址允许 HTTP），不能包含路径、账号或查询参数。')
  }
  return base.origin
}

export function configuration(env = process.env) {
  if (!env.RB_BASE_URL || !env.RB_TOKEN) throw new Error('请运行 Skill 包中的 node install.mjs，或同时配置 RB_BASE_URL 和 RB_TOKEN；不要把凭证粘贴到对话中。')
  const origin = normalizeOrigin(env.RB_BASE_URL)
  if (!/^rb_agent_[A-Za-z0-9_-]{43}$/.test(env.RB_TOKEN)) throw new Error('RB_TOKEN 格式无效，请从账号页复制完整凭证。')
  return { origin, token: env.RB_TOKEN }
}

function profileFor(saved, origin) {
  return saved.profiles.find(profile => profile.origin === origin || profile.aliases.includes(origin))
}

function isLoopback(origin) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
}

export function loopbackOrigin(value) {
  const origin = normalizeOrigin(value)
  if (!isLoopback(origin)) throw new Error('端口关联仅支持本机回环站点，不能关联生产站点的凭证。')
  return origin
}

async function readStore(env) {
  let raw
  try { raw = await readFile(codexPaths(env).config, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error('无法读取本机配置，请检查 Codex 目录权限。')
  }
  try {
    const saved = JSON.parse(raw)
    if (saved.version === 1) {
      const config = configuration(saved)
      return { version: 2, defaultOrigin: config.origin, profiles: [{ ...config, aliases: [] }] }
    }
    if (saved.version !== 2 || !Array.isArray(saved.profiles) || !saved.profiles.length) throw new Error('version')
    const origins = new Set()
    const profiles = saved.profiles.map(profile => {
      const config = configuration({ RB_BASE_URL: profile.origin, RB_TOKEN: profile.token })
      if (!Array.isArray(profile.aliases)) throw new Error('aliases')
      if (profile.localPorts !== undefined && typeof profile.localPorts !== 'boolean') throw new Error('local ports')
      if (profile.localPorts) loopbackOrigin(config.origin)
      const aliases = profile.aliases.map(alias => {
        loopbackOrigin(config.origin)
        return loopbackOrigin(alias)
      })
      for (const origin of [config.origin, ...aliases]) {
        if (origins.has(origin)) throw new Error('duplicate origin')
        origins.add(origin)
      }
      return { ...config, aliases, ...(profile.localPorts ? { localPorts: true } : {}) }
    })
    if (profiles.filter(profile => profile.localPorts).length > 1) throw new Error('ambiguous local ports')
    const defaultOrigin = normalizeOrigin(saved.defaultOrigin)
    if (!profiles.some(profile => profile.origin === defaultOrigin)) throw new Error('default origin')
    return { version: 2, defaultOrigin, profiles }
  } catch { throw new Error('本机配置无效，请运行 node install.mjs configure。') }
}

export async function readConfiguration(env = process.env, targetOrigin, { exact = false } = {}) {
  const target = targetOrigin === undefined ? undefined : normalizeOrigin(targetOrigin)
  const saved = await readStore(env)
  if (!saved) return null
  const origin = target ?? saved.defaultOrigin
  // 精确配置优先；仅显式启用的本地配置可匹配其余回环端口，不回退到生产凭证。
  const profile = profileFor(saved, origin) ?? (!exact && isLoopback(origin) ? saved.profiles.find(profile => profile.localPorts) : undefined)
  return profile ? { origin, token: profile.token } : null
}

export async function loadConfiguration(env = process.env, targetOrigin) {
  const target = targetOrigin === undefined ? undefined : normalizeOrigin(targetOrigin)
  // 两个值必须来自同一来源，不能将本机 Token 拼到另一套环境变量的站点上。
  if (env.RB_BASE_URL !== undefined || env.RB_TOKEN !== undefined) {
    const config = configuration(env)
    if (target && target !== config.origin) throw new Error('目标站点与 RB_BASE_URL 环境变量不同；请移除成对的环境变量后使用多站点配置。')
    return config
  }
  const config = await readConfiguration(env, target)
  if (config) return config
  if (target) throw new Error(`尚未配置站点 ${target}；运行 node install.mjs configure --base-url ${target} 添加凭证，共享数据库的本地端口可在 configure 时追加 --local-ports 一次启用。`)
  return configuration({})
}

/** 供 AI 查看已配置站点，不返回任何凭证。 */
export async function listSites(env = process.env) {
  const saved = await readStore(env)
  const override = env.RB_BASE_URL !== undefined || env.RB_TOKEN !== undefined ? configuration(env).origin : undefined
  return { defaultOrigin: saved?.defaultOrigin ?? null, sites: saved?.profiles.map(({ origin, aliases, localPorts }) => ({ origin, aliases, ...(localPorts ? { localPorts: true } : {}) })) ?? [],
    ...(override ? { environmentOverride: override } : {}) }
}

async function changeStore(env, change) {
  const paths = codexPaths(env)
  await secureDirectory(paths.settings)
  // 多个 worktree 可以同时配置；锁住读取、合并和替换，避免最后写入者丢掉其他站点。
  const lockPath = join(paths.settings, 'config.lock')
  const deadline = Date.now() + 5000
  let lock
  while (!lock) {
    try { lock = await open(lockPath, 'wx', 0o600) }
    catch (error) {
      if (error.code !== 'EEXIST') throw new Error('无法锁定本机配置，请检查目录权限。')
      if (Date.now() >= deadline) throw new Error('另一个配置操作尚未结束，请稍后重试；若该进程已退出，请检查 requirement-board/config.lock。')
      await delay(50)
    }
  }
  const temporary = join(paths.settings, `.config-${randomUUID()}.tmp`)
  try {
    const saved = await change(await readStore(env))
    if (!saved) return paths.config
    await writeFile(temporary, JSON.stringify(saved, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, paths.config)
  } finally {
    try { await rm(temporary, { force: true }) }
    finally { await lock.close(); await rm(lockPath) }
  }
  return paths.config
}

export async function saveConfiguration(config, env = process.env) {
  const validated = configuration({ RB_BASE_URL: config.origin, RB_TOKEN: config.token })
  if (config.localPorts !== undefined && typeof config.localPorts !== 'boolean') throw new Error('localPorts 必须为布尔值。')
  if (config.localPorts) loopbackOrigin(validated.origin)
  return changeStore(env, saved => {
    saved ??= { version: 2, defaultOrigin: validated.origin, profiles: [] }
    const existing = profileFor(saved, validated.origin)
    if (config.localPorts && saved.profiles.some(profile => profile.localPorts && profile !== existing)) {
      throw new Error('已有本地端口通用配置；更新凭证请使用其原站点，不同数据库请单独 configure 且不加 --local-ports。')
    }
    const profile = existing ?? { ...validated, aliases: [] }
    profile.token = validated.token
    if (config.localPorts === true) profile.localPorts = true
    else if (config.localPorts === false) delete profile.localPorts
    if (!existing) saved.profiles.push(profile)
    return saved
  })
}

export async function saveSiteAlias(from, target, env = process.env, expectedToken) {
  const source = loopbackOrigin(from), origin = loopbackOrigin(target)
  return changeStore(env, saved => {
    const profile = saved && profileFor(saved, source)
    if (!profile) throw new Error('来源站点尚未配置，请先用 configure 添加一次本地凭证。')
    if (expectedToken !== undefined && profile.token !== expectedToken) throw new Error('来源凭证已被其他配置操作更改，请重新验证端口关联。')
    const existing = profileFor(saved, origin)
    if (existing && existing !== profile) throw new Error('目标站点已有独立配置，不能覆盖其凭证或端口关联。')
    if (existing) return null
    profile.aliases.push(origin)
    return saved
  })
}

export async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') {
    const sid = await windowsUserSid()
    await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true })
  } else await chmod(directory, 0o700)
}
