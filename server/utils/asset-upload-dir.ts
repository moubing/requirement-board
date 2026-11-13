import { isAbsolute, relative, resolve } from 'node:path'

export const ASSET_UPLOAD_DIR_ENV = 'ASSET_UPLOAD_DIR'

export interface ResolveAssetUploadDirOptions {
  cwd?: string
  configuredDir?: string
  nodeEnv?: string
}

export function getDefaultAssetUploadDir(cwd = process.cwd()) {
  return resolve(cwd, '.local-data', 'uploads')
}

function normalizeForComparison(path: string) {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function resolveAssetUploadDir(options: ResolveAssetUploadDirOptions = {}) {
  const cwd = options.cwd ?? process.cwd()
  const configuredDir = options.configuredDir ?? process.env[ASSET_UPLOAD_DIR_ENV]
  const uploadDir = configuredDir?.trim()
    ? resolve(cwd, configuredDir)
    : getDefaultAssetUploadDir(cwd)
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV
  const relativeToPublic = relative(
    normalizeForComparison(resolve(cwd, 'public')),
    normalizeForComparison(uploadDir),
  )

  if (!relativeToPublic || (!relativeToPublic.startsWith('..') && !isAbsolute(relativeToPublic))) {
    throw new Error('ASSET_UPLOAD_DIR must not be inside the public directory because uploads require authentication.')
  }

  if (
    nodeEnv === 'test' &&
    normalizeForComparison(uploadDir) === normalizeForComparison(getDefaultAssetUploadDir(cwd))
  ) {
    throw new Error(
      'Tests must set ASSET_UPLOAD_DIR to an isolated temporary directory; refusing to use the local development upload directory.',
    )
  }

  return uploadDir
}
