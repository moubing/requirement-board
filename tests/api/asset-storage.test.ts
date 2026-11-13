import { Readable } from 'node:stream'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import {
  createAssetUrl,
  createS3AssetStorage,
  parseAssetUrl,
} from '../../server/services/asset-storage'
import {
  resolveAssetStorageConfig,
  type S3AssetStorageConfig,
} from '../../server/utils/asset-storage-config'

const s3Config: S3AssetStorageConfig = {
  driver: 's3',
  endpoint: 'http://minio.internal:9000',
  region: 'us-east-1',
  bucket: 'requirement-board-files',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  forcePathStyle: true,
}

const assetUrl = '/uploads/asset_abcdefghijkl.png'

describe('asset storage configuration', () => {
  it('uses local storage by default', () => {
    const config = resolveAssetStorageConfig({
      cwd: process.cwd(),
      env: { ASSET_UPLOAD_DIR: '.tmp/uploads' },
      nodeEnv: 'development',
    })

    expect(config).toMatchObject({ driver: 'local' })
  })

  it('parses the MinIO S3 configuration', () => {
    expect(resolveAssetStorageConfig({
      env: {
        ASSET_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'http://minio.internal:9000/',
        S3_BUCKET: 'requirement-board-files',
        S3_ACCESS_KEY_ID: 'access-key',
        S3_SECRET_ACCESS_KEY: 'secret-key',
        S3_FORCE_PATH_STYLE: 'true',
      },
    })).toEqual({
      driver: 's3',
      endpoint: 'http://minio.internal:9000',
      region: 'us-east-1',
      bucket: 'requirement-board-files',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      forcePathStyle: true,
    })
  })

  it('rejects incomplete S3 configuration', () => {
    expect(() => resolveAssetStorageConfig({
      env: { ASSET_STORAGE_DRIVER: 's3' },
    })).toThrow(/S3_ENDPOINT/)
  })
})

describe('asset URL mapping', () => {
  it('maps generated names to stable public URLs', () => {
    expect(createAssetUrl('asset_abcdefghijkl.png')).toBe(assetUrl)
    expect(parseAssetUrl(assetUrl)).toEqual({
      assetId: 'asset_abcdefghijkl',
      fileName: 'asset_abcdefghijkl.png',
    })
  })

  it('rejects nested and non-generated paths', () => {
    expect(parseAssetUrl('/uploads/nested/asset_abcdefghijkl.png')).toBeNull()
    expect(parseAssetUrl('/uploads/arbitrary.png')).toBeNull()
  })
})

describe('S3 asset storage', () => {
  it('uses the configured bucket and uploads path for object operations', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('image')]),
        ContentLength: 5,
        ETag: 'etag',
      })
      .mockResolvedValueOnce({})
    const destroy = vi.fn()
    const client = { send, destroy } as unknown as S3Client
    const storage = createS3AssetStorage(s3Config, client)
    const bytes = new Uint8Array([1, 2, 3])

    await storage.put(assetUrl, bytes, 'image/png')
    const object = await storage.get(assetUrl)
    await storage.remove(assetUrl)
    storage.close()

    const put = send.mock.calls[0]?.[0]
    const get = send.mock.calls[1]?.[0]
    const remove = send.mock.calls[2]?.[0]
    expect(put).toBeInstanceOf(PutObjectCommand)
    expect(put.input).toMatchObject({
      Bucket: 'requirement-board-files',
      Key: 'uploads/asset_abcdefghijkl.png',
      Body: bytes,
      ContentType: 'image/png',
    })
    expect(get).toBeInstanceOf(GetObjectCommand)
    expect(get.input).toMatchObject({
      Bucket: 'requirement-board-files',
      Key: 'uploads/asset_abcdefghijkl.png',
    })
    expect(remove).toBeInstanceOf(DeleteObjectCommand)
    expect(remove.input).toMatchObject({
      Bucket: 'requirement-board-files',
      Key: 'uploads/asset_abcdefghijkl.png',
    })
    expect(object).toMatchObject({ contentLength: 5, etag: 'etag' })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('treats missing S3 objects as absent assets', async () => {
    const send = vi.fn().mockRejectedValue({
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    })
    const client = { send, destroy: vi.fn() } as unknown as S3Client
    const storage = createS3AssetStorage(s3Config, client)

    await expect(storage.get(assetUrl)).resolves.toBeNull()
  })
})
