import { eq } from 'drizzle-orm'

import { assets, requirements } from '../../db/schema'
import {
  createAssetUrl,
  parseAssetFileName,
  useAssetStorage,
} from '../../services/asset-storage'
import { requireAppContext } from '../../utils/request-context'

export default defineEventHandler(async (event) => {
  const fileName = getRouterParam(event, 'fileName')
  const parsed = fileName ? parseAssetFileName(fileName) : null
  if (!parsed) throw createError({ statusCode: 404, statusMessage: 'Asset not found' })

  const { db, currentUserId, projectId } = await requireAppContext(event)
  const url = createAssetUrl(parsed.fileName)
  const [asset] = await db
    .select({
      mimeType: assets.mimeType,
      size: assets.size,
      url: assets.url,
      uploadedById: assets.uploadedById,
      requirementProjectId: requirements.projectId,
      templateProjectId: assets.templateProjectId,
    })
    .from(assets)
    .leftJoin(requirements, eq(requirements.id, assets.requirementId))
    .where(eq(assets.id, parsed.assetId))
    .limit(1)

  const canRead = asset?.requirementProjectId
    ? asset.requirementProjectId === projectId
    : asset?.templateProjectId ? asset.templateProjectId === projectId : asset?.uploadedById === currentUserId
  if (!asset || asset.url !== url || !canRead) {
    throw createError({ statusCode: 404, statusMessage: 'Asset not found' })
  }

  let object
  try {
    object = await useAssetStorage().get(url)
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Asset storage is unavailable',
      cause: error,
    })
  }

  if (!object) throw createError({ statusCode: 404, statusMessage: 'Asset not found' })

  setResponseHeader(event, 'Content-Type', asset.mimeType)
  setResponseHeader(event, 'Content-Length', object.contentLength ?? asset.size)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  setResponseHeader(event, 'Vary', 'Cookie')
  if (object.etag) setResponseHeader(event, 'ETag', object.etag)
  if (object.lastModified) setResponseHeader(event, 'Last-Modified', object.lastModified.toUTCString())

  return sendStream(event, object.body)
})
