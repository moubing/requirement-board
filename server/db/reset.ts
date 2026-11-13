import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

import { createDatabase } from './client'
import { assertLocalResetTarget, resetLocalDatabase } from './reset-local'
import { validateSeedManuals } from './seed-data'

const args = process.argv.slice(2)
if (args.length !== 1 || args[0] !== '--confirm') {
  console.log('本机数据库重置：保留 admin、密码、会话及 AI 凭证，其余数据替换为七篇使用手册。')
  console.log('请先停止 pnpm dev，运行 pnpm db:migrate，再执行 pnpm db:reset --confirm。')
  console.log('执行前自动备份并校验归档；只允许本机 Docker Compose 开发库。上传文件不做物理删除。')
  process.exitCode = args.length ? 1 : 0
} else {
  await reset()
}

async function reset() {
  let connection: ReturnType<typeof createDatabase> | undefined
  try {
    if (existsSync('.env')) loadEnvFile('.env')
    const databaseUrl = process.env.DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board'
    assertLocalResetTarget(databaseUrl)
    if (process.env.NUXT_DATABASE_URL) assertLocalResetTarget(process.env.NUXT_DATABASE_URL)
    validateSeedManuals()

    const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim()
    // 防止 Docker 被切换到 SSH/TCP 远端 context，或连接变量指向另一台主机。
    if (process.env.DOCKER_HOST) throw new Error('请移除 DOCKER_HOST 覆盖后使用本机 Docker context。')
    const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) throw new Error('Docker context 不是本机连接。')
    const container = 'requirement-board-postgres'
    const [inspection] = JSON.parse(docker(['inspect', container]))
    const labels = inspection.Config.Labels
    const bindings = inspection.NetworkSettings.Ports['5432/tcp'] ?? []
    if (labels['com.docker.compose.service'] !== 'postgres'
      || resolve(labels['com.docker.compose.project.working_dir'] ?? '') !== process.cwd()
      || !bindings.some((binding: { HostPort: string }) => binding.HostPort === '5438')) {
      throw new Error('PostgreSQL 容器不是本仓库的本机 5438 端口实例。')
    }
    connection = createDatabase(databaseUrl)
    const { client, db } = connection
    const [target] = await client`select current_database() as database, current_user as role`
    if (target?.database !== 'requirement_board' || target?.role !== 'requirement') throw new Error('实际数据库与本机目标不一致。')
    const [cluster] = await client`select system_identifier::text as id from pg_control_system()`
    const containerCluster = docker(['exec', container, 'psql', '-U', 'requirement', '-d', 'requirement_board', '-Atc', 'select system_identifier from pg_control_system()'])
    if (cluster?.id !== containerCluster) throw new Error('连接的 PostgreSQL 与备份容器不是同一实例。')
    async function assertNoOtherConnections() {
      const [active] = await client`select count(*)::int as count from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'`
      if (active!.count !== 0) throw new Error('开发库仍有其他连接，请先停止开发服务并断开数据库客户端。')
    }
    await assertNoOtherConnections()
    const backupDirectory = resolve('.local-data', 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    const backupPath = resolve(backupDirectory, 'requirement_board.dump')
    const dump = execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'requirement', '-d', 'requirement_board', '-Fc'], {
      windowsHide: true, maxBuffer: 256 * 1024 * 1024,
    })
    if (dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('备份归档格式无效，未重置。')
    writeFileSync(backupPath, dump, { flag: 'wx', mode: 0o600 })
    execFileSync('docker', ['exec', '-i', container, 'pg_restore', '--list'], {
      input: dump, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    })
    console.log(`数据库备份已验证：${backupPath}`)
    await assertNoOtherConnections()
    const result = await resetLocalDatabase(db)
    console.log(`本机重置完成：${result.created} 篇手册，协作代次 ${result.editEpoch}；admin 的密码、会话及 AI 凭证已保留。`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : '本机重置失败')
    process.exitCode = 1
  } finally {
    await connection?.client.end()
  }
}
