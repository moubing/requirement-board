import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { codexPaths, secureDirectory } from './config.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
// 按站点和凭证隔离；缓存命中仍须服务端重新认证、检查最新内容。
const directory = config => join(codexPaths().settings, 'cache', hash(`${config.origin}\n${config.token}`))
const body = value => ({ title: value.title, contentJson: value.contentJson })

export async function readCachedDocument(config, identifier) {
  try {
    const root = directory(config)
    const id = identifier.startsWith('req_') ? identifier : JSON.parse(await readFile(join(root, `${hash(identifier)}.ref`), 'utf8'))
    if (typeof id !== 'string' || !/^req_[a-zA-Z0-9_-]{1,100}$/.test(id)) return null
    const value = JSON.parse(await readFile(join(root, `${hash(id)}.json`), 'utf8'))
    if (value.id !== id || value.schemaVersion !== 3 || !/^3:[a-f0-9]{64}$/.test(value.contentToken)
      || value.integrity !== hash(JSON.stringify(body(value)))) return null
    return value
  } catch { return null }
}

export async function cacheDocument(config, value, alias) {
  const id = value.requirementId ?? value.id
  if (!/^req_[a-zA-Z0-9_-]{1,100}$/.test(id) || typeof value.title !== 'string' || !value.contentJson || !/^3:[a-f0-9]{64}$/.test(value.contentToken)) return
  const root = directory(config)
  await secureDirectory(root)
  async function atomic(name, data) {
    const temporary = join(root, `${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 })
      await rename(temporary, join(root, name))
    } finally { await rm(temporary, { force: true }) }
  }
  await atomic(`${hash(id)}.json`, { id, schemaVersion: 3, contentToken: value.contentToken, ...body(value), integrity: hash(JSON.stringify(body(value))) })
  for (const name of new Set([alias, value.key].filter(Boolean))) await atomic(`${hash(name)}.ref`, id)
}

export function hydrateDocument(response, cached) {
  if (!response.notModified) return response
  if (!cached || response.contentToken !== cached.contentToken || (response.requirementId ?? response.id) !== cached.id) throw new Error('缓存与服务端内容不一致，请重新读取')
  return { ...response, ...body(cached), cacheReused: true }
}
