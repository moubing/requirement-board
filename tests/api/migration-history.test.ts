import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { expect, it } from 'vitest'

// 覆盖合并分支前后两种已落库的时间：相同 SQL 不能因 journal 时间变化再次执行。
it.each([1792161277753, 1792200614088])('保留已有数据，从 AI 回执迁移时间 %s 升级', async appliedTime => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board_test')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const isolatedCi = process.env.CI === 'true' && url.hostname === 'postgres' && url.port === '5432'
    && url.username === 'requirement_ci' && url.pathname === '/requirement_board_test'
  if ((!local && !isolatedCi) || !url.pathname.endsWith('_test')) {
    throw new Error('迁移回归只允许本机或 Jenkins 一次性独立测试库')
  }
  url.pathname = '/postgres'
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} })
  const name = `rb_migration_${randomUUID().replaceAll('-', '')}_test`
  const folder = await mkdtemp(join(tmpdir(), 'rb-migration-history-'))
  let client: ReturnType<typeof postgres> | undefined
  let created = false
  try {
    await admin.unsafe(`create database "${name}"`)
    created = true
    url.pathname = `/${name}`
    client = postgres(url.toString(), { max: 1, onnotice: () => {} })
    const db = drizzle(client)
    const journal = JSON.parse(await readFile(resolve('drizzle/meta/_journal.json'), 'utf8'))
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 15)
    entries[15].when = appliedTime
    await mkdir(join(folder, 'meta'))
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
    await Promise.all(entries.map((entry: { tag: string }) => copyFile(resolve('drizzle', `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))))
    await migrate(db, { migrationsFolder: folder })
    await client`insert into projects (id, name, code) values ('migration-marker', '保留已有数据', 'HISTORY')`

    await migrate(db, { migrationsFolder: resolve('drizzle') })
    await migrate(db, { migrationsFolder: resolve('drizzle') })
    expect((await client`select name from projects where id = 'migration-marker'`)[0]?.name).toBe('保留已有数据')
    expect((await client`select count(*)::integer as count from drizzle.__drizzle_migrations`)[0]?.count).toBe(journal.entries.length)
    expect((await client`select data_type from information_schema.columns where table_name = 'agent_suggestions' and column_name = 'completed_annotations'`)[0]?.data_type).toBe('jsonb')
    expect((await client`select to_regclass('document_write_receipts') as name`)[0]?.name).toBe('document_write_receipts')
  } finally {
    await client?.end()
    if (created) await admin.unsafe(`drop database "${name}"`)
    await admin.end()
    await rm(folder, { recursive: true })
  }
}, 30_000)
