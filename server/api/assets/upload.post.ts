import { nanoid } from 'nanoid'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'

import { assets, requirementDraftAssets, requirements } from '../../db/schema'
import { createAssetUrl, useAssetStorage } from '../../services/asset-storage'
import { requireAppContext } from '../../utils/request-context'
import { draftIdSchema } from '../../../shared/drafts/validation'
import { lockAssetReferences } from '../../services/asset-references'
import { lockDraft, ownedDraft } from '../../services/requirement-drafts'
import { assertRequirementUnlocked } from '../../services/agent-locks'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const querySchema = z.object({
  requirementId: z.string().optional(),
  draftId: draftIdSchema.optional(),
  uploadId: draftIdSchema.optional(),
}).refine(value => !value.draftId && !value.uploadId || Boolean(value.draftId && value.uploadId && value.requirementId))

function safeFileExtension(fileName: string) {
  return fileName.match(/\.([A-Za-z0-9]{1,16})$/)?.[1]?.toLowerCase() ?? 'bin'
}

export default defineEventHandler(async (event) => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const parsedQuery = querySchema.safeParse(getQuery(event))
  if (!parsedQuery.success) throw createError({ statusCode: 400, message: '图片上传参数无效' })
  const query = parsedQuery.data

  if (query.requirementId) {
    const requirement = await db.query.requirements.findFirst({
      where: (table, { and, eq }) => and(
        eq(table.id, query.requirementId!),
        eq(table.projectId, projectId),
      ),
      columns: { id: true },
    })
    if (!requirement) {
      throw createError({ statusCode: 404, statusMessage: 'Requirement not found' })
    }
  }

  // 恢复或网络超时重试时，可以仅携带任务 ID 领取已完成的上传。
  const form = event.headers.get('content-type')?.includes('multipart/form-data')
    ? await readMultipartFormData(event) : undefined
  const file = form?.find((item) => item.name === 'file')

  if (file && file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Image must be smaller than 5 MB' })
  }

  const storage = useAssetStorage()
  let writtenUrl: string | undefined
  try {
    return await db.transaction(async tx => {
      await lockAssetReferences(tx)
      if (query.requirementId) {
        await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, query.requirementId)).for('update')
        await assertRequirementUnlocked(tx, query.requirementId)
      }
      if (query.draftId) {
        await lockDraft(tx, query.draftId)
        const draft = await ownedDraft(tx, query.draftId, query.requirementId!, currentUserId)
        if (!draft || draft.closedAt) throw createError({ statusCode: 409, message: '请先保存有效草稿，再上传图片' })
        // 同一图片任务可能从另一设备恢复；按用户与任务去重，并保护每份关联草稿。
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`upload:${currentUserId}:${query.uploadId}`}))`)
        const [existing] = await tx.select().from(assets).where(and(eq(assets.uploadedById, currentUserId), eq(assets.uploadTaskId, query.uploadId!)))
        if (existing) {
          if (existing.requirementId !== query.requirementId) throw createError({ statusCode: 409, message: '图片上传任务不属于当前需求' })
          await tx.insert(requirementDraftAssets).values({ draftId: query.draftId, assetId: existing.id }).onConflictDoNothing()
          return existing
        }
      }
      if (!file?.data || !file.filename || !file.type?.startsWith('image/')) {
        throw createError({ statusCode: 400, message: query.uploadId ? '原图片尚未上传，请回原浏览器重试，或移除此图片后重新插入' : 'Only image uploads are supported' })
      }
      const id = `asset_${nanoid(12)}`
      const url = createAssetUrl(`${id}.${safeFileExtension(file.filename)}`)
      try { await storage.put(url, file.data, file.type) }
      catch { throw createError({ statusCode: 503, statusMessage: 'Failed to store uploaded asset' }) }
      writtenUrl = url
      const [asset] = await tx.insert(assets).values({
        id,
        requirementId: query.requirementId,
        fileName: file.filename,
        mimeType: file.type,
        size: file.data.byteLength,
        url,
        uploadTaskId: query.uploadId,
        uploadedById: currentUserId,
      }).returning()
      if (query.draftId) await tx.insert(requirementDraftAssets).values({ draftId: query.draftId, assetId: asset!.id })
      return asset!
    })
  } catch (error) {
    if (writtenUrl) await storage.remove(writtenUrl).catch(() => undefined)
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 500, statusMessage: 'Failed to save uploaded asset' })
  }
})
