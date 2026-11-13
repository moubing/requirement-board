import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { codexPaths, configuration, listSites, loopbackOrigin, normalizeOrigin, readConfiguration, saveConfiguration, saveSiteAlias } from './scripts/config.mjs'
import { prompt, SetupCancelled } from './scripts/prompt.mjs'
import { skillFiles } from './scripts/files.mjs'
import { downloadSkill } from './scripts/archive.mjs'
import { request } from './scripts/rb.mjs'
import { openInstallTerminal } from './scripts/terminal.mjs'

const bundledSkill = dirname(fileURLToPath(import.meta.url))
const actions = ['install', 'update', 'configure', 'alias', 'uninstall']
const backupRetention = 3
const backupName = /^skill-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
export class ConfigurationRequired extends Error {
  constructor() { super('需要配置站点或凭证，请在用户终端运行 install.mjs configure；Windows 可追加 --open-terminal。') }
}
async function entry(path) {
  try { return await lstat(path) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function checkDirectories(paths) {
  // 移动或清理前核验固定目录，拒绝会把操作引到 Codex 目录以外的链接。
  if (paths.skill !== join(paths.root, 'skills', 'requirement-board') || paths.settings !== join(paths.root, 'requirement-board')) throw new Error('Skill 目录无效。')
  for (const path of [paths.root, paths.skills, paths.skill, paths.settings, join(paths.settings, 'backups')]) {
    const value = await entry(path)
    if (value && (!value.isDirectory() || value.isSymbolicLink())) throw new Error('Skill 或配置目录被文件或链接占用，请先检查该路径。')
  }
}
async function checkInstalled(paths) {
  if (!await entry(paths.skill)) return false
  let text
  try { text = await readFile(join(paths.skill, 'SKILL.md'), 'utf8') } catch { /* 下方统一报错。 */ }
  if (!text || !/^name: requirement-board\r?$/m.test(text)) throw new Error('安装目录不是可识别的 Requirement Board Skill，未更改任何文件。')
  return true
}
function checkNode() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请先安装 Node.js 22 或更高版本。')
}
function environmentNotice(env, log) {
  if (env.RB_BASE_URL !== undefined || env.RB_TOKEN !== undefined) log('当前环境含 RB_BASE_URL / RB_TOKEN，业务命令仍优先使用环境变量；本次未修改它们。')
}
async function bundleFiles(source) {
  return Promise.all(skillFiles.map(async path => ({ path, content: await readFile(join(source, path)) })))
}
async function backupSkill(paths) {
  const backups = join(paths.settings, 'backups')
  await mkdir(backups, { recursive: true })
  const backup = join(backups, `skill-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
  await rename(paths.skill, backup)
  return backup
}
async function isSkillBackup(path) {
  const directory = await entry(path)
  if (!directory?.isDirectory() || directory.isSymbolicLink()) return false
  const marker = await entry(join(path, 'SKILL.md'))
  if (!marker?.isFile() || marker.isSymbolicLink()) return false
  return /^name: requirement-board\r?$/m.test(await readFile(join(path, 'SKILL.md'), 'utf8'))
}
async function pruneSkillBackups(paths, latestBackup, log) {
  let removed = 0, failed = false
  try {
    await checkDirectories(paths)
    const backups = join(paths.settings, 'backups')
    if (!await entry(backups)) return
    const candidates = []
    for (const name of await readdir(backups)) {
      if (!backupName.test(name)) continue
      const path = resolve(backups, name)
      if (dirname(path) !== backups) throw new Error('备份清理目录无效。')
      try { if (await isSkillBackup(path)) candidates.push({ name, path }) }
      catch { failed = true }
    }
    // 名称含创建时间；即使系统时间回拨，也始终保留本次操作的恢复点。
    candidates.sort((a, b) => b.name.localeCompare(a.name))
    const keep = new Set(latestBackup ? [latestBackup] : [])
    for (const candidate of candidates) {
      if (keep.size < backupRetention) keep.add(candidate.path)
      if (keep.has(candidate.path)) continue
      try {
        // 删除前再次核验父目录和 Skill 身份；不跟随备份目录或标识文件的链接。
        await checkDirectories(paths)
        if (await isSkillBackup(candidate.path)) { await rm(candidate.path, { recursive: true }); removed++ }
      } catch (error) { if (error.code !== 'ENOENT') failed = true }
    }
  } catch { failed = true }
  if (removed) log(`已清理 ${removed} 份旧 Skill 备份，自动备份保留上限为 ${backupRetention} 份。`)
  if (failed) log('部分旧 Skill 备份未能清理，已保留；下次安装、更新或卸载时会重试。本次操作已完成。')
}
async function replaceSkill(files, paths, afterReplace = async () => {}) {
  await checkDirectories(paths)
  const installed = await checkInstalled(paths)
  await mkdir(paths.skills, { recursive: true })
  const staging = await mkdtemp(join(paths.skills, '.requirement-board-install-'))
  if (dirname(staging) !== paths.skills) throw new Error('安装临时目录无效。')
  let moved = false, backup
  try {
    for (const file of files) {
      await mkdir(dirname(join(staging, file.path)), { recursive: true })
      await writeFile(join(staging, file.path), file.content)
    }
    if (installed) backup = await backupSkill(paths)
    try {
      await rename(staging, paths.skill)
      moved = true
      await afterReplace()
    } catch (error) {
      if (moved) await rename(paths.skill, staging)
      if (backup) await rename(backup, paths.skill)
      throw error
    }
  } finally { await rm(staging, { recursive: true, force: true }) }
  return backup
}

/** 安装默认复用同站点的本机配置；configure 才强制进入交互。 */
export async function install({ env = process.env, ask = prompt, log = console.log, source = bundledSkill,
  baseUrl = undefined, reconfigure = false, localPorts = false } = {}) {
  checkNode()
  if (localPorts && !reconfigure) throw new Error('--local-ports 仅用于 configure，表示本地各端口共用数据库和凭证。')
  const paths = codexPaths(env)
  await checkDirectories(paths)
  const installed = await checkInstalled(paths)
  const suppliedOrigin = baseUrl === undefined ? undefined : normalizeOrigin(baseUrl)
  if (localPorts && suppliedOrigin) loopbackOrigin(suppliedOrigin)
  const sameDirectory = resolve(source) === paths.skill
  const files = sameDirectory || (reconfigure && installed) ? undefined : await bundleFiles(source)
  log(`\nRequirement Board · ${reconfigure ? '配置站点' : '安装'}\n`)
  log(`Skill 位置：${paths.skill}`)
  let previous
  try { previous = await readConfiguration(env, suppliedOrigin, { exact: reconfigure }) } catch { log('现有配置无法读取，需要检查本机配置。') }
  const reuse = !reconfigure && previous
  let config = reuse ? previous : undefined
  let defaultOrigin = previous?.origin ?? env.RB_BASE_URL ?? 'http://localhost:3000'
  let rejectedOrigin
  while (!config) {
    let origin = suppliedOrigin
    while (!origin) {
      const value = await ask('站点 URL（RB_BASE_URL）', { defaultValue: defaultOrigin })
      try { origin = localPorts ? loopbackOrigin(value.trim()) : normalizeOrigin(value.trim()) } catch (error) { log(error.message) }
    }
    let matching
    if (origin !== rejectedOrigin) {
      try { matching = await readConfiguration(env, origin, { exact: true }) } catch { /* 保存时仍会拒绝覆盖损坏的配置。 */ }
    }
    const reusable = matching?.token ?? ''
    let candidate
    while (!candidate) {
      const value = await ask(`Token（RB_TOKEN，输入隐藏${reusable ? '，回车保留已保存凭证' : ''}）`, { hidden: true })
      try { candidate = configuration({ RB_BASE_URL: origin, RB_TOKEN: value.trim() || reusable }) }
      catch (error) { log(error.message) }
    }
    log('正在验证站点和凭证…')
    try {
      const schema = await request(candidate, 'schema')
      if (schema.schemaVersion !== 3 || !schema.nodes || !schema.marks) throw new Error('schema')
      config = candidate
    } catch {
      log('验证失败，请检查 URL、凭证有效期、项目权限及网络后重新输入。按 Ctrl+C 取消。')
      defaultOrigin = origin
      rejectedOrigin = origin
    }
  }
  const save = async () => { if (!reuse) await saveConfiguration({ ...config, ...(localPorts ? { localPorts: true } : {}) }, env) }
  let backup
  if (!files) await save()
  else backup = await replaceSkill(files, paths, save)
  log(reuse ? '\n安装完成，已复用原有 URL 和 Token，配置文件保持不变。' : '\n站点配置已验证并保存，其他站点和默认站点保持不变。后续无需手动设置环境变量。')
  if (localPorts) log('已启用本地端口通用配置：localhost、127.0.0.1 和 [::1] 的其他端口自动复用本地凭证，无需逐个关联。')
  if (backup) log(`原 Skill 已备份：${backup}`)
  await pruneSkillBackups(paths, backup, log)
  environmentNotice(env, log)
  log('在 Codex 中调用 $requirement-board，附上需求链接和修改要求。尚未发现新 Skill 时，重启 Codex 后再试。')
  return { skill: paths.skill, config: paths.config, backup }
}

/** 更新只替换公开的 Skill 文件，凭证过期也不妨碍更新。 */
export async function update({ env = process.env, log = console.log, baseUrl = undefined, source = bundledSkill, fromBundle = false } = {}) {
  checkNode()
  const paths = codexPaths(env)
  await checkDirectories(paths)
  await checkInstalled(paths)
  let previous
  try { previous = await readConfiguration(env) } catch { /* 更新本身不依赖有效 Token。 */ }
  const origin = baseUrl === undefined ? previous?.origin ?? (env.RB_BASE_URL ? normalizeOrigin(env.RB_BASE_URL) : undefined) : normalizeOrigin(baseUrl)
  if (previous && !await readConfiguration(env, origin)) throw new Error('更新链接与已配置站点不同，未发送凭证或更改安装。添加站点请使用 configure。')
  if (!fromBundle && !origin) throw new Error('找不到更新站点，请追加 --base-url <站点 URL>，无需提供 Token。')
  log('\nRequirement Board · 更新 Skill\n')
  const files = fromBundle ? await bundleFiles(source) : await downloadSkill(origin)
  const backup = await replaceSkill(files, paths)
  log('Skill 已更新，原有 URL 和 Token 保持不变，无需重新填写。')
  if (backup) log(`原 Skill 已备份：${backup}`)
  await pruneSkillBackups(paths, backup, log)
  if (!previous) log('尚无可用的本机配置；首次使用前运行 install.mjs configure。')
  environmentNotice(env, log)
  log('请重新读取更新后的 SKILL.md；若 Codex 仍显示旧 Skill，可重启 Codex。')
  return { skill: paths.skill, config: paths.config, backup }
}

/** 显式关联共用数据库的本地端口，不复制或暴露凭证。 */
export async function aliasSite({ env = process.env, from, baseUrl, log = console.log } = {}) {
  checkNode()
  const source = loopbackOrigin(from), origin = loopbackOrigin(baseUrl)
  await checkDirectories(codexPaths(env))
  const config = await readConfiguration(env, source, { exact: true })
  if (!config) throw new Error('来源站点尚未配置，请先用 configure 添加一次本地凭证。')
  const sites = (await listSites(env)).sites
  const sourceProfile = sites.find(site => site.origin === source || site.aliases.includes(source))
  const targetProfile = sites.find(site => site.origin === origin || site.aliases.includes(origin))
  if (targetProfile && targetProfile !== sourceProfile) throw new Error('目标站点已有独立配置，不能覆盖其凭证或端口关联。')
  try {
    const schema = await request({ ...config, origin }, 'schema')
    if (schema.schemaVersion !== 3 || !schema.nodes || !schema.marks) throw new Error('schema')
  } catch { throw new Error('目标端口验证失败，未保存关联。请确认服务已启动、共用数据库且凭证有效。') }
  await saveSiteAlias(source, origin, env, config.token)
  log(`已关联本地站点：${origin}，复用 ${source} 的凭证。默认站点和其他配置保持不变。`)
  environmentNotice(env, log)
}

/** 移出 Codex 的 skills 目录即完成卸载，原文件留在专用备份目录。 */
export async function uninstall({ env = process.env, log = console.log, purgeConfig = false } = {}) {
  const paths = codexPaths(env)
  await checkDirectories(paths)
  const installed = await checkInstalled(paths)
  const config = purgeConfig ? await entry(paths.config) : null
  if (config && (!config.isFile() || config.isSymbolicLink())) throw new Error('配置文件路径不是普通文件，未执行卸载或清除。')
  let backup
  if (installed) backup = await backupSkill(paths)
  try { if (config) await rm(paths.config) }
  catch (error) { if (backup) await rename(backup, paths.skill); throw error }
  log(installed ? 'Skill 已卸载。' : 'Skill 尚未安装。')
  log(purgeConfig ? '本机 URL 和 Token 已清除。' : '已保留本机 URL 和 Token，重新安装时可直接复用。')
  if (backup) log(`原 Skill 文件已保留：${backup}`)
  await pruneSkillBackups(paths, backup, log)
  log('网站上的凭证仍有效；如需停用，请在账号页撤销凭证。')
  environmentNotice(env, log)
  return { skill: paths.skill, config: paths.config, backup }
}

const usage = '用法：node install.mjs [install|update|configure|uninstall] [--base-url <站点 URL>] [--open-terminal] [--non-interactive]；共用数据库的本地开发：configure --base-url <本地站点> --local-ports；单独关联端口：alias --from <已有本地站点> --base-url <新本地站点>；卸载可追加 --purge-config。Token 必须在终端输入。'
export function installerOptions(args) {
  const options = { action: 'install', openTerminal: false, terminalChild: false, nonInteractive: false,
    baseUrl: undefined, from: undefined, purgeConfig: false, fromBundle: false, localPorts: false, help: false }
  let index = 0
  if (actions.includes(args[0])) { options.action = args[0]; index++ }
  for (; index < args.length; index++) {
    if (args[index] === '--open-terminal') options.openTerminal = true
    else if (args[index] === '--terminal-child') options.terminalChild = true
    else if (args[index] === '--non-interactive') options.nonInteractive = true
    else if (args[index] === '--purge-config') options.purgeConfig = true
    else if (args[index] === '--from-bundle') options.fromBundle = true
    else if (args[index] === '--local-ports') options.localPorts = true
    else if (args[index] === '--help') options.help = true
    else if (args[index] === '--base-url' && args[index + 1] && options.baseUrl === undefined) options.baseUrl = normalizeOrigin(args[++index])
    else if (args[index] === '--from' && args[index + 1] && options.from === undefined) options.from = normalizeOrigin(args[++index])
    else throw new Error(usage)
  }
  if (options.openTerminal && options.terminalChild) throw new Error('终端启动参数不能同时使用。')
  if ((options.purgeConfig && options.action !== 'uninstall') || (options.fromBundle && options.action !== 'update')) throw new Error(usage)
  if (options.localPorts && options.action !== 'configure') throw new Error('--local-ports 仅用于 configure。')
  if (options.localPorts && options.baseUrl) loopbackOrigin(options.baseUrl)
  if ((options.from && options.action !== 'alias') || (options.action === 'alias' && !options.help && (!options.from || !options.baseUrl))) throw new Error(usage)
  if (options.terminalChild && !['install', 'configure'].includes(options.action)) throw new Error(usage)
  if (options.openTerminal && (options.nonInteractive || !['install', 'configure'].includes(options.action))) throw new Error('--open-terminal 只用于安装或重新配置，不能与 --non-interactive 同用。')
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options
  try {
    options = installerOptions(process.argv.slice(2))
    if (options.help) console.log(usage)
    else if (options.action === 'update') await update(options)
    else if (options.action === 'uninstall') await uninstall(options)
    else if (options.action === 'alias') await aliasSite(options)
    else {
      const nonInteractive = options.nonInteractive || options.openTerminal || !process.stdin.isTTY
      try {
        await install({ baseUrl: options.baseUrl, reconfigure: options.action === 'configure', localPorts: options.localPorts,
          ask: nonInteractive ? async () => { throw new ConfigurationRequired() } : prompt })
      } catch (error) {
        if (!(error instanceof ConfigurationRequired) || !options.openTerminal) throw error
        console.log('需要填写配置，正在打开独立终端。等待用户完成并关闭窗口…')
        process.exitCode = await openInstallTerminal({ installerPath: fileURLToPath(import.meta.url), baseUrl: options.baseUrl, action: options.action, localPorts: options.localPorts })
        console.log(process.exitCode === 0 ? '安装终端已确认成功。' : '操作未完成或已取消，请查看安装终端的提示。')
      }
    }
  } catch (error) {
    console.error(error instanceof SetupCancelled ? error.message : '操作未完成：' + error.message)
    process.exitCode = error instanceof SetupCancelled ? 130 : error instanceof ConfigurationRequired ? 2 : 1
  } finally {
    if (options?.terminalChild) {
      try { await prompt('按回车关闭安装终端', {}) } catch { /* 用户也可以直接关闭窗口。 */ }
    }
  }
}
