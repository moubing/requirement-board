import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const digest = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex')

/** 不连接数据库，不重写迁移；--base 明确指定已经合入的基线。 */
export async function readMigrationHistory(read) {
  const journal = JSON.parse(await read('drizzle/meta/_journal.json'))
  return Promise.all(journal.entries.map(async entry => ({ ...entry, hash: digest(await read(`drizzle/${entry.tag}.sql`)) })))
}

export function checkMigrationHistory(current, base = []) {
  const errors = [], tags = new Set(), prefixes = new Set(), times = new Set()
  for (const [index, entry] of current.entries()) {
    const prefix = entry.tag.split('_')[0]
    if (entry.idx !== index || !(prefix === String(index).padStart(4, '0') || /^\d{14}$/.test(prefix))) errors.push(`${entry.tag}：迁移名称无效或 journal 顺序不连续`)
    if (tags.has(entry.tag) || times.has(entry.when) || prefixes.has(prefix)) errors.push(`${entry.tag}：迁移名称、快照前缀或执行时间重复`)
    if (!Number.isSafeInteger(entry.when) || entry.when <= (current[index - 1]?.when ?? 0)) errors.push(`${entry.tag}：执行时间必须严格递增`)
    tags.add(entry.tag); prefixes.add(prefix); times.add(entry.when)
  }
  for (const previous of base) {
    const next = current.find(entry => entry.hash === previous.hash && entry.when === previous.when)
      ?? current.find(entry => entry.tag === previous.tag)
      ?? current.find(entry => entry.hash === previous.hash)
    if (!next) errors.push(`${previous.tag}：已合入的迁移被移除`)
    else {
      if (next.hash !== previous.hash) errors.push(`${previous.tag}：已合入的 SQL 被修改，应新增补偿迁移`)
      if (next.when !== previous.when) errors.push(`${previous.tag}：已合入的执行时间被修改（${previous.when} → ${next.when}），可能重复执行或跳过迁移`)
    }
  }
  const latest = Math.max(0, ...base.map(entry => entry.when))
  for (const entry of current) {
    if (!base.some(previous => previous.hash === entry.hash) && entry.when <= latest) {
      errors.push(`${entry.tag}：新迁移早于基线末尾，已有数据库可能跳过它；请基于最新基线重新生成尚未发布的迁移`)
    }
  }
  return [...new Set(errors)]
}

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  if (args.length && (args.length !== 2 || args[0] !== '--base' || args[1].startsWith('-'))) throw new Error('用法：pnpm db:check:migrations [--base <目标分支或提交>]')
  const current = await readMigrationHistory(path => readFile(resolve(path), 'utf8'))
  const base = args.length ? await readMigrationHistory(path => execFileSync('git', ['show', `${args[1]}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) : []
  const errors = checkMigrationHistory(current, base)
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(`迁移检查通过：${current.length} 条迁移${args.length ? `，基线 ${args[1]} 的 SQL 和执行时间保持不变` : '；合并前请另加 --base <目标分支> 检查历史不变性'}。`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
