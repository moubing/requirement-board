import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { install, uninstall, update } from '../../skills/requirement-board/install.mjs'
import { codexPaths } from '../../skills/requirement-board/scripts/config.mjs'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rm: vi.fn(fs.rm), rename: vi.fn(fs.rename) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
afterEach(async () => {
  vi.mocked(rm).mockImplementation(actualFs.rm)
  vi.mocked(rename).mockImplementation(actualFs.rename)
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('rb-installer-backups-')) throw new Error('Invalid test cleanup path')
    await rm(root, { recursive: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rb-installer-backups-'))
  roots.push(root)
  const env = { CODEX_HOME: join(root, 'codex') }, paths = codexPaths(env), log = vi.fn()
  await mkdir(paths.settings, { recursive: true })
  await writeFile(paths.config, JSON.stringify({ version: 1, RB_BASE_URL: 'https://board.example', RB_TOKEN: `rb_agent_${'a'.repeat(43)}` }))
  await update({ env, fromBundle: true, log })
  const backups = join(paths.settings, 'backups')
  await mkdir(backups, { recursive: true })
  return { root, env, paths, log, backups }
}
function backupName(day: number, year = 2020) {
  return `skill-${year}-01-${String(day).padStart(2, '0')}T00-00-00-000Z-00000000-0000-4000-8000-${String(day).padStart(12, '0')}`
}
async function seedBackup(backups: string, day: number, year = 2020) {
  const path = join(backups, backupName(day, year))
  await mkdir(path)
  await writeFile(join(path, 'SKILL.md'), '---\nname: requirement-board\ndescription: 测试备份\n---\n')
  await writeFile(join(path, 'notes.md'), `自定义内容 ${day}`)
  return path
}

it('成功更新回收旧备份，只保留最近三份，并保留配置、缓存及本次恢复点', async () => {
  const f = await fixture()
  for (let day = 1; day <= 5; day++) await seedBackup(f.backups, day)
  await mkdir(join(f.paths.settings, 'cache'))
  await writeFile(join(f.paths.settings, 'cache', 'document.json'), '文档缓存')
  await writeFile(join(f.paths.skill, 'notes.md'), '本次原安装的自定义文件')
  const before = await readFile(f.paths.config), modifiedAt = (await stat(f.paths.config)).mtimeMs
  const result = await update({ env: f.env, fromBundle: true, log: f.log })
  expect((await readdir(f.backups)).sort()).toEqual([backupName(4), backupName(5), basename(result.backup!)].sort())
  expect(await readFile(join(result.backup!, 'notes.md'), 'utf8')).toBe('本次原安装的自定义文件')
  expect(await readFile(f.paths.config)).toEqual(before)
  expect((await stat(f.paths.config)).mtimeMs).toBe(modifiedAt)
  expect(await readFile(join(f.paths.settings, 'cache', 'document.json'), 'utf8')).toBe('文档缓存')
  expect(await readFile(join(f.paths.skill, 'install.mjs'))).toEqual(await readFile(resolve('skills/requirement-board/install.mjs')))
})

it('反复安装和卸载同样限制备份数量，系统时间回拨也保留本次恢复点', async () => {
  const f = await fixture()
  for (let day = 1; day <= 4; day++) await seedBackup(f.backups, day, 2099)
  const result = await install({ env: f.env, log: f.log, ask: async () => { throw new Error('不应询问凭证') } })
  expect((await readdir(f.backups)).sort()).toEqual([backupName(3, 2099), backupName(4, 2099), basename(result.backup!)].sort())
  const removed = await uninstall({ env: f.env, log: f.log })
  await expect(access(f.paths.skill)).rejects.toThrow()
  expect(await readdir(f.backups)).toHaveLength(3)
  await access(join(removed.backup!, 'SKILL.md'))
  await access(f.paths.config)
})

it('手动备份、其他 Skill、普通文件及链接不被回收，嵌套链接的外部目标保持不变', async () => {
  const f = await fixture()
  const oldest = await seedBackup(f.backups, 1)
  for (let day = 2; day <= 5; day++) await seedBackup(f.backups, day)
  const manual = join(f.backups, 'skill-before-reinstall-123'), outside = join(f.root, 'outside')
  await mkdir(manual); await writeFile(join(manual, 'notes.md'), '手动保留')
  await mkdir(outside); await writeFile(join(outside, 'SKILL.md'), 'name: requirement-board')
  await writeFile(join(outside, 'keep.txt'), '外部文件')
  const linked = join(f.backups, backupName(6)), other = await seedBackup(f.backups, 7)
  await writeFile(join(other, 'SKILL.md'), 'name: other-skill')
  const plainFile = join(f.backups, backupName(8))
  await writeFile(plainFile, '普通文件')
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(outside, linked, linkType)
  await symlink(outside, join(oldest, 'linked-custom-folder'), linkType)
  await update({ env: f.env, fromBundle: true, log: f.log })
  await expect(access(oldest)).rejects.toThrow()
  expect(await readFile(join(manual, 'notes.md'), 'utf8')).toBe('手动保留')
  expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('外部文件')
  expect(await readFile(join(linked, 'SKILL.md'), 'utf8')).toBe('name: requirement-board')
  expect(await readFile(join(other, 'SKILL.md'), 'utf8')).toBe('name: other-skill')
  expect(await readFile(plainFile, 'utf8')).toBe('普通文件')
  expect(await readdir(f.backups)).toHaveLength(7)
})

it('替换失败恢复原安装且不清理任何历史备份', async () => {
  const f = await fixture()
  for (let day = 1; day <= 5; day++) await seedBackup(f.backups, day)
  await writeFile(join(f.paths.skill, 'notes.md'), '回滚后恢复')
  const before = (await readdir(f.backups)).sort()
  let rejected = false
  vi.mocked(rename).mockImplementation(async (source, target) => {
    if (!rejected && target === f.paths.skill && String(source).includes('.requirement-board-install-')) {
      rejected = true
      throw new Error('模拟安装目录替换失败')
    }
    return actualFs.rename(source, target)
  })
  await expect(update({ env: f.env, fromBundle: true, log: f.log })).rejects.toThrow('替换失败')
  expect(await readFile(join(f.paths.skill, 'notes.md'), 'utf8')).toBe('回滚后恢复')
  expect((await readdir(f.backups)).sort()).toEqual(before)
})

it('清理失败不影响已完成的更新，下次成功更新会继续回收', async () => {
  const f = await fixture()
  const blocked = await seedBackup(f.backups, 1)
  for (let day = 2; day <= 5; day++) await seedBackup(f.backups, day)
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (path === blocked) throw new Error('模拟文件占用')
    return actualFs.rm(path, options)
  })
  const result = await update({ env: f.env, fromBundle: true, log: f.log })
  expect(await readdir(f.backups)).toHaveLength(4)
  await access(result.backup!)
  expect(f.log.mock.calls.flat().join('\n')).toContain('部分旧 Skill 备份未能清理')
  expect(await readFile(join(f.paths.skill, 'install.mjs'))).toEqual(await readFile(resolve('skills/requirement-board/install.mjs')))
  vi.mocked(rm).mockImplementation(actualFs.rm)
  await update({ env: f.env, fromBundle: true, log: f.log })
  expect(await readdir(f.backups)).toHaveLength(3)
  await expect(access(blocked)).rejects.toThrow()
})

it('备份根目录为链接时停止操作，不访问或清理外部目录', async () => {
  const f = await fixture(), outside = join(f.root, 'outside')
  await mkdir(outside)
  await seedBackup(outside, 1)
  await rm(f.backups, { recursive: true })
  await symlink(outside, f.backups, process.platform === 'win32' ? 'junction' : 'dir')
  const original = await readFile(join(f.paths.skill, 'install.mjs'))
  await expect(update({ env: f.env, fromBundle: true, log: f.log })).rejects.toThrow('链接')
  expect(await readFile(join(f.paths.skill, 'install.mjs'))).toEqual(original)
  expect(await readdir(outside)).toEqual([backupName(1)])
})
