import { createDatabase } from '../db/client'
import { DEFAULT_ASSET_GC_GRACE_MS, garbageCollectAssets } from '../services/asset-gc'
import { createAssetStorage } from '../services/asset-storage'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://requirement:requirement@localhost:5438/requirement_board'
const configuredHours = process.env.ASSET_GC_GRACE_HOURS
const graceMs = configuredHours === undefined
  ? DEFAULT_ASSET_GC_GRACE_MS
  : Number(configuredHours) * 60 * 60 * 1000
const dryRun = process.argv.includes('--dry-run')
const storage = createAssetStorage()
const { client, db } = createDatabase(databaseUrl)

garbageCollectAssets(db, {
  storage,
  graceMs,
  dryRun,
})
  .then(async (result) => {
    await client.end()
    storage.close()
    console.log(JSON.stringify(result, null, 2))
  })
  .catch(async (error) => {
    await client.end()
    storage.close()
    console.error(error)
    process.exit(1)
  })
