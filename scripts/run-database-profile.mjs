import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const profiles = {
  staging: {
    envFile: '.env.staging.local',
    database: 'requirement_board_staging',
    user: 'rb_staging_debug',
    readOnly: false,
  },
  'production-readonly': {
    envFile: '.env.production-readonly.local',
    database: 'requirement_board_prod',
    user: 'rb_prod_readonly',
    readOnly: true,
  },
}

const [profileName, action = 'check'] = process.argv.slice(2)
const profile = profiles[profileName]

if (!profile || !['check', 'dev'].includes(action)) {
  console.error('Usage: node scripts/run-database-profile.mjs <staging|production-readonly> <check|dev>')
  process.exit(1)
}

if (profile.readOnly && action === 'dev') {
  console.error('The production read-only profile cannot start Nuxt because authentication requires session writes.')
  console.error('Use db:check:prod:readonly for connection verification and the deployed HTTPS app for page diagnostics.')
  process.exit(1)
}

function parseEnvFile(contents) {
  const values = {}

  for (const [index, originalLine] of contents.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = originalLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) {
      throw new Error(`Invalid environment entry on line ${index + 1}`)
    }

    let value = match[2].trim()
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }

  return values
}

function redact(message, password) {
  return password ? message.replaceAll(password, '<redacted>') : message
}

function validateProfileEnv(values) {
  if (values.DATABASE_PROFILE !== profileName) {
    throw new Error(`${profile.envFile} must contain DATABASE_PROFILE=${profileName}`)
  }

  if (!values.DATABASE_URL || values.DATABASE_URL.includes('<')) {
    throw new Error(`${profile.envFile} does not contain a configured DATABASE_URL`)
  }

  const url = new URL(values.DATABASE_URL)
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const user = decodeURIComponent(url.username)

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres protocol')
  }
  if (url.hostname !== '127.0.0.1' || url.port !== '15439') {
    throw new Error('Remote profiles must connect through the SSH tunnel at 127.0.0.1:15439')
  }
  if (database !== profile.database || user !== profile.user) {
    throw new Error(`Expected database ${profile.database} as role ${profile.user}`)
  }
  if (!url.password) {
    throw new Error('DATABASE_URL must contain the generated debug-role password')
  }

  if (profileName === 'staging') {
    if (values.ASSET_STORAGE_DRIVER !== 's3') {
      throw new Error('The staging profile must use the staging MinIO bucket')
    }
    if (values.S3_BUCKET !== 'requirement-board-files-staging') {
      throw new Error('The staging profile must use requirement-board-files-staging')
    }
    if (!values.S3_ACCESS_KEY_ID || !values.S3_SECRET_ACCESS_KEY || values.S3_ACCESS_KEY_ID.includes('<')) {
      throw new Error('The staging profile does not contain configured MinIO credentials')
    }
  }

  if (profile.readOnly && values.ASSET_STORAGE_DRIVER !== 'local') {
    throw new Error('The production read-only profile must not contain production object-storage access')
  }

  return { url, database, user }
}

async function verifyDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 1,
    max: 1,
    prepare: false,
  })

  try {
    const [state] = await sql`
      select
        current_database() as database,
        current_user as "user",
        current_setting('transaction_read_only') as "transactionReadOnly",
        has_database_privilege(current_user, current_database(), 'TEMP') as "canCreateTemporary",
        has_schema_privilege(current_user, 'public', 'CREATE') as "canCreateInSchema",
        has_table_privilege(current_user, 'public.requirements', 'SELECT') as "canSelect",
        has_table_privilege(current_user, 'public.requirements', 'INSERT') as "canInsert",
        has_table_privilege(current_user, 'public.requirements', 'UPDATE') as "canUpdate",
        has_table_privilege(current_user, 'public.requirements', 'DELETE') as "canDelete",
        has_table_privilege(current_user, 'public.requirements', 'TRUNCATE') as "canTruncate"
    `

    if (state.database !== profile.database || state.user !== profile.user) {
      throw new Error('The server reported an unexpected database identity')
    }
    if (state.canCreateInSchema || state.canCreateTemporary || state.canTruncate) {
      throw new Error('The debug role unexpectedly has DDL, temporary-table, or truncate permission')
    }
    if (!state.canSelect) {
      throw new Error('The debug role cannot read application tables')
    }

    const actualReadOnly = state.transactionReadOnly === 'on'
    if (actualReadOnly !== profile.readOnly) {
      throw new Error(`Expected transaction_read_only=${profile.readOnly ? 'on' : 'off'}`)
    }

    const writePermissions = [state.canInsert, state.canUpdate, state.canDelete]
    if (profile.readOnly && writePermissions.some(Boolean)) {
      throw new Error('The production debug role unexpectedly has write permission')
    }
    if (!profile.readOnly && writePermissions.some((permission) => !permission)) {
      throw new Error('The staging debug role is missing business-table write permissions')
    }

    if (action === 'dev') {
      const [tables] = await sql`
        select
          to_regclass('public.project_member_roles') as project_member_roles,
          to_regclass('public.project_access_requests') as project_access_requests,
          to_regclass('public.project_invitations') as project_invitations,
          to_regclass('public.audit_events') as audit_events,
          to_regclass('public.requirement_drafts') as requirement_drafts,
          to_regclass('public.requirement_draft_assets') as requirement_draft_assets,
          to_regclass('public.requirement_collaboration_documents') as requirement_collaboration_documents,
          to_regclass('public.requirement_edit_events') as requirement_edit_events,
          to_regclass('public.agent_tokens') as agent_tokens,
          to_regclass('public.agent_snapshots') as agent_snapshots,
          to_regclass('public.agent_suggestions') as agent_suggestions,
          to_regclass('public.requirement_agent_locks') as requirement_agent_locks
      `
      const missing = Object.entries(tables).filter(([, table]) => !table).map(([name]) => name)
      if (missing.length) {
        throw new Error(
          `数据库结构落后于当前代码，缺少表：${missing.join(', ')}。`
          + '\n请先通过服务器部署流程同步新版应用和迁移（包括 0004_concerned_patch、0005_bitter_carnage、0006_past_clint_barton、0007_familiar_mikhail_rasputin、0008_youthful_hedge_knight）；'
          + '如需先在本地验证新功能，请改用 pnpm dev。'
          + '\n本地 pnpm db:migrate 默认只迁移本地开发库，不会更新远程 staging。',
        )
      }
    }

    if (profile.readOnly) {
      try {
        await sql`update public.requirements set title = title where false`
        throw new Error('The production read-only role accepted an UPDATE statement')
      } catch (error) {
        if (error?.code !== '25006') throw error
      }
    } else {
      await sql`update public.requirements set title = title where false`
    }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function runNuxt(env) {
  const nuxtPackagePath = require.resolve('nuxt/package.json')
  const nuxtBin = resolve(dirname(nuxtPackagePath), 'bin/nuxt.mjs')
  const child = spawn(process.execPath, [nuxtBin, 'dev'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  })

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit(signal ? 1 : (code ?? 1)))
  })
  process.exitCode = exitCode
}

const envPath = resolve(projectRoot, profile.envFile)
let profileValues

try {
  profileValues = parseEnvFile(await readFile(envPath, 'utf8'))
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error(`Missing ${profile.envFile}. Provision it before using the remote profile.`)
    console.error('Keep the database tunnel open in another terminal with: pnpm db:tunnel')
    process.exit(1)
  }
  throw error
}

let validated
try {
  validated = validateProfileEnv(profileValues)
  await verifyDatabase(profileValues.DATABASE_URL)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[database:${profileName}] ${redact(message, validated?.url.password)}`)
  console.error('请根据上方错误检查 SSH 隧道、profile 配置或数据库迁移状态。')
  process.exit(1)
}

console.log(
  `[database:${profileName}] verified ${profile.database} as ${profile.user} (${profile.readOnly ? 'read-only' : 'business read/write, no schema changes'})`,
)

if (action === 'dev') {
  const childEnv = {
    ...process.env,
    ...profileValues,
    DATABASE_PROFILE: profileName,
    DATABASE_URL: profileValues.DATABASE_URL,
    NUXT_DATABASE_URL: profileValues.DATABASE_URL,
  }

  if (profile.readOnly) {
    childEnv.ASSET_STORAGE_DRIVER = 'local'
    childEnv.ASSET_UPLOAD_DIR = '.local-data/production-readonly-uploads'
    delete childEnv.S3_ACCESS_KEY_ID
    delete childEnv.S3_SECRET_ACCESS_KEY
  }

  await runNuxt(childEnv)
}
