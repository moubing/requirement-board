// 与 drizzle-kit 一致地读取本地环境；部署入口继续要求显式 DATABASE_URL。
import { loadEnvFile } from 'node:process'
try { loadEnvFile() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
process.env.DATABASE_URL ??= 'postgres://requirement:requirement@localhost:5438/requirement_board'
await import('../../deploy/migrate')
