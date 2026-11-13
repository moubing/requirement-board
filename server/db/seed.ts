import { createDatabase } from './client'
import { seedDatabase } from './seed-data'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board'
const { client, db } = createDatabase(databaseUrl)

try {
  const result = await db.transaction(tx => seedDatabase(tx))
  console.log(`种子初始化完成：新增 ${result.created} 篇手册，保留 ${result.skipped} 篇已有手册。`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await client.end()
}
