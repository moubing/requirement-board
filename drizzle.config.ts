import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  migrations: { prefix: 'timestamp' },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board',
  },
  strict: true,
  verbose: true,
})
