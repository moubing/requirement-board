import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

export type Database = ReturnType<typeof drizzle<typeof schema>>
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let cachedClient: postgres.Sql | undefined
let cachedDb: Database | undefined

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 5 })
  return {
    client,
    db: drizzle(client, { schema }),
  }
}

export function useDatabase() {
  if (cachedDb) return cachedDb

  const config = useRuntimeConfig()
  cachedClient = postgres(config.databaseUrl, { max: 5 })
  cachedDb = drizzle(cachedClient, { schema })
  return cachedDb
}

export async function closeDatabase() {
  await cachedClient?.end()
  cachedClient = undefined
  cachedDb = undefined
}
