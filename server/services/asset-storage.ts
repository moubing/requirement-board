import { createReadStream } from 'node:fs'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import {
  resolveAssetStorageConfig,
  type AssetStorageConfig,
  type LocalAssetStorageConfig,
  type S3AssetStorageConfig,
} from '../utils/asset-storage-config'

const ASSET_URL_PREFIX = '/uploads/'
const ASSET_OBJECT_PREFIX = 'uploads/'
const ASSET_FILE_NAME_PATTERN = /^(asset_[A-Za-z0-9_-]{12})\.([A-Za-z0-9]{1,16})$/

export interface AssetObject {
  body: Readable
  contentLength?: number
  etag?: string
  lastModified?: Date
}

export interface AssetStorage {
  put(url: string, data: Uint8Array, contentType: string): Promise<void>
  get(url: string): Promise<AssetObject | null>
  remove(url: string): Promise<void>
  close(): void
}

export interface ParsedAssetFileName {
  assetId: string
  fileName: string
}

export function parseAssetFileName(fileName: string): ParsedAssetFileName | null {
  if (!fileName || basename(fileName) !== fileName) return null
  const match = ASSET_FILE_NAME_PATTERN.exec(fileName)
  if (!match?.[1]) return null
  return { assetId: match[1], fileName }
}

export function createAssetUrl(fileName: string) {
  if (!parseAssetFileName(fileName)) throw new Error('Invalid generated asset file name')
  return `${ASSET_URL_PREFIX}${fileName}`
}

export function parseAssetUrl(url: string): ParsedAssetFileName | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url, 'http://local').pathname)
  } catch {
    return null
  }

  if (!pathname.startsWith(ASSET_URL_PREFIX)) return null
  return parseAssetFileName(pathname.slice(ASSET_URL_PREFIX.length))
}

function requireAssetUrl(url: string) {
  const parsed = parseAssetUrl(url)
  if (!parsed) throw new Error('Invalid asset URL')
  return parsed
}

function localFilePath(url: string, config: LocalAssetStorageConfig) {
  return join(config.uploadDir, requireAssetUrl(url).fileName)
}

function objectKey(url: string) {
  return `${ASSET_OBJECT_PREFIX}${requireAssetUrl(url).fileName}`
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: string, $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'NoSuchKey'
    || candidate.name === 'NotFound'
    || candidate.$metadata?.httpStatusCode === 404
}

export function createLocalAssetStorage(config: LocalAssetStorageConfig): AssetStorage {
  return {
    async put(url, data) {
      await mkdir(config.uploadDir, { recursive: true })
      await writeFile(localFilePath(url, config), data)
    },

    async get(url) {
      const path = localFilePath(url, config)
      try {
        const metadata = await stat(path)
        return {
          body: createReadStream(path),
          contentLength: metadata.size,
          lastModified: metadata.mtime,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },

    async remove(url) {
      try {
        await unlink(localFilePath(url, config))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },

    close() {},
  }
}

export function createS3AssetStorage(
  config: S3AssetStorageConfig,
  client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }),
): AssetStorage {
  return {
    async put(url, data, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(url),
        Body: data,
        ContentLength: data.byteLength,
        ContentType: contentType,
      }))
    },

    async get(url) {
      try {
        const object = await client.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey(url),
        }))
        if (!object.Body) return null

        return {
          body: object.Body as Readable,
          contentLength: object.ContentLength,
          etag: object.ETag,
          lastModified: object.LastModified,
        }
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    },

    async remove(url) {
      await client.send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(url),
      }))
    },

    close() {
      client.destroy()
    },
  }
}

export function createAssetStorage(config: AssetStorageConfig = resolveAssetStorageConfig()) {
  return config.driver === 's3'
    ? createS3AssetStorage(config)
    : createLocalAssetStorage(config)
}

let cachedAssetStorage: AssetStorage | undefined

export function useAssetStorage() {
  cachedAssetStorage ??= createAssetStorage()
  return cachedAssetStorage
}
