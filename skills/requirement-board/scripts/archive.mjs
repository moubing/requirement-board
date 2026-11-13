import { gunzipSync } from 'node:zlib'
import { normalizeOrigin } from './config.mjs'

const maximumBytes = 8 * 1024 * 1024
const invalidArchive = () => new Error('Skill 下载包无效，请确认站点已部署最新版本；原安装未更改。')

/** 只接受本站生成的普通 ustar 文件，不解压链接、扩展头或包外路径。 */
export function unpackSkillArchive(compressed) {
  let tar
  try { tar = gunzipSync(compressed, { maxOutputLength: maximumBytes }) }
  catch { throw invalidArchive() }
  const files = [], names = new Set()
  let offset = 0, ended = false
  const string = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
  const octal = value => /^[0-7]+$/.test(value.trim()) ? Number.parseInt(value.trim(), 8) : NaN
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      ended = tar.length - offset >= 1024 && tar.subarray(offset).every(byte => byte === 0)
      break
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    const name = string(header, 0, 100)
    const size = octal(string(header, 124, 12))
    const path = name.startsWith('requirement-board/') ? name.slice('requirement-board/'.length) : ''
    if (checksum !== octal(string(header, 148, 8)) || string(header, 257, 6) !== 'ustar'
      || string(header, 345, 155) || !['0', ''].includes(string(header, 156, 1))
      || !path || path.split('/').some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)
        || part.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
      || /(?:^|\/)config\.json$/i.test(path) || names.has(path.toLowerCase())
      || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length || files.length >= 128) throw invalidArchive()
    names.add(path.toLowerCase())
    files.push({ path, content: tar.subarray(offset + 512, offset + 512 + size) })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!ended || !['SKILL.md', 'install.mjs', 'scripts/rb.mjs', 'scripts/config.mjs', 'scripts/files.mjs'].every(path => files.some(file => file.path === path))
    || !/^name: requirement-board\r?$/m.test(files.find(file => file.path === 'SKILL.md').content.toString('utf8'))) throw invalidArchive()
  return files
}

export async function downloadSkill(origin) {
  // 下载是公开请求，绝不携带本机 Token，也不跟随到其他站点的重定向。
  let response
  try { response = await fetch(`${normalizeOrigin(origin)}/api/agent/skill`, { redirect: 'error', signal: AbortSignal.timeout(30_000) }) }
  catch { throw new Error('无法下载 Skill，请检查站点和网络；原安装与配置未更改。') }
  if (!response.ok || !response.body) throw new Error(`Skill 下载失败（HTTP ${response.status}）；原安装与配置未更改。`)
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > maximumBytes) throw invalidArchive()
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return unpackSkillArchive(Buffer.concat(chunks))
}
