import { resolveAssetUploadDir } from './asset-upload-dir'

export const ASSET_STORAGE_DRIVER_ENV = 'ASSET_STORAGE_DRIVER'

export interface LocalAssetStorageConfig {
  driver: 'local'
  uploadDir: string
}

export interface S3AssetStorageConfig {
  driver: 's3'
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export type AssetStorageConfig = LocalAssetStorageConfig | S3AssetStorageConfig

export interface ResolveAssetStorageConfigOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  nodeEnv?: string
}

function requiredEnv(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required when ASSET_STORAGE_DRIVER=s3`)
  return value
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('S3_FORCE_PATH_STYLE must be either true or false')
}

function normalizeEndpoint(value: string) {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('S3_ENDPOINT must be a valid HTTP or HTTPS URL')
  }

  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('S3_ENDPOINT must use HTTP or HTTPS')
  }

  return endpoint.toString().replace(/\/$/, '')
}

export function resolveAssetStorageConfig(
  options: ResolveAssetStorageConfigOptions = {},
): AssetStorageConfig {
  const env = options.env ?? process.env
  const driver = env[ASSET_STORAGE_DRIVER_ENV]?.trim().toLowerCase() || 'local'

  if (driver === 'local') {
    return {
      driver,
      uploadDir: resolveAssetUploadDir({
        cwd: options.cwd,
        configuredDir: env.ASSET_UPLOAD_DIR,
        nodeEnv: options.nodeEnv,
      }),
    }
  }

  if (driver !== 's3') {
    throw new Error('ASSET_STORAGE_DRIVER must be either local or s3')
  }

  return {
    driver,
    endpoint: normalizeEndpoint(requiredEnv(env, 'S3_ENDPOINT')),
    region: env.S3_REGION?.trim() || 'us-east-1',
    bucket: requiredEnv(env, 'S3_BUCKET'),
    accessKeyId: requiredEnv(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: requiredEnv(env, 'S3_SECRET_ACCESS_KEY'),
    forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
  }
}
