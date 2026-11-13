import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const powershellString = value => `'${value.replaceAll("'", "''")}'`
// Start-Process 的 ArgumentList 最终为一条 Windows 命令行，按原生 argv 规则逐项转义。
const windowsArgument = value => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'

export function windowsTerminalScript(nodePath, installerPath, baseUrl, action = 'install', localPorts = false) {
  if (!['install', 'configure'].includes(action)) throw new Error('只有安装和配置需要交互终端。')
  const args = [installerPath, action, '--terminal-child', ...(baseUrl ? ['--base-url', baseUrl] : []), ...(localPorts ? ['--local-ports'] : [])]
  return `$ErrorActionPreference = 'Stop'\n$installer = Start-Process -FilePath ${powershellString(nodePath)} -ArgumentList ${powershellString(args.map(windowsArgument).join(' '))} -WindowStyle Normal -PassThru -Wait\nexit $installer.ExitCode`
}

/** 终端窗口直接持有输入输出；AI 的父进程只能拿到安装退出码。 */
export async function openInstallTerminal({ installerPath, baseUrl, action = 'install', localPorts = false, env = process.env,
  platform = process.platform, nodePath = process.execPath, run = promisify(execFile) }) {
  if (platform !== 'win32') throw new Error('自动打开安装终端目前支持 Windows；请在用户可直接输入的终端运行 node install.mjs --base-url <站点地址>。')
  const script = windowsTerminalScript(nodePath, installerPath, baseUrl, action, localPorts)
  try {
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { env, windowsHide: true })
  } catch (error) {
    if (typeof error.code === 'number') return error.code === 130 ? 130 : 1
    throw new Error('无法打开安装终端，请在用户自己的终端手动运行 install.mjs。')
  }
  return 0
}
