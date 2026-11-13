import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '../server/db/schema'
import { upgradeDocumentSchemas } from '../server/services/document-schema-upgrade'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const client = postgres(databaseUrl, { max: 1 })

try {
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: process.env.DRIZZLE_MIGRATIONS_DIR ?? './drizzle',
  })
  const upgraded = await upgradeDocumentSchemas(db)
  console.log(`数据库迁移完成，已升级 ${upgraded} 篇共同草稿的单元格身份`)
} finally {
  await client.end()
}
