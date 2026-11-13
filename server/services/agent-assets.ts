import { and, eq, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { Database } from '../db/client'
import { agentAssetUploads, agentSuggestions, assets, requirements } from '../db/schema'
import { createAssetUrl, useAssetStorage } from './asset-storage'
import { agentRequirement } from './agent-reading'
import { activeAgentLock, requirementLocked } from './agent-locks'
import { lockAssetReferences } from './asset-references'

export const MAX_AGENT_IMAGE_BYTES = 5 * 1024 * 1024

/** 按文件头识别允许的位图，不信任扩展名或 multipart 自报 MIME。 */
export function agentImageType(bytes: Buffer) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return { extension: 'png', mime: 'image/png' }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' }
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return { extension: 'gif', mime: 'image/gif' }
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' }
  throw createError({ statusCode: 415, message: '请选择 PNG、JPEG、GIF 或 WebP 图片文件' })
}

export async function uploadAgentImage(db: Database, projectId: string, userId: string, tokenId: string,
  input: { requirementId?: string; createRequestId?: string; uploadId: string }, file: { data: Buffer; filename: string }) {
  if (!file.data.length || file.data.length > MAX_AGENT_IMAGE_BYTES) throw createError({ statusCode: 413, message: '图片不能为空且不得超过 5 MiB' })
  const type = agentImageType(file.data)
  const hash = createHash('sha256').update(file.data).digest('hex')
  const storage = useAssetStorage()
  let writtenUrl: string | undefined
  try {
    return await db.transaction(async tx => {
      await lockAssetReferences(tx)
      let requirementId: string | undefined
      if (input.requirementId) {
        const requirement = await agentRequirement(tx, projectId, input.requirementId)
        requirementId = requirement.id
        await tx.select({ id: requirements.id }).from(requirements).where(eq(requirements.id, requirementId)).for('update')
        const active = await activeAgentLock(tx, requirementId)
        if (active && active.lock.tokenId !== tokenId) throw requirementLocked(active.view)
      } else {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent:${userId}:${input.createRequestId}`}, 0))`)
      }
      const task = `agent:${input.uploadId}`
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`upload:${userId}:${task}`}, 0))`)
      const existing = await tx.query.assets.findFirst({ where: and(eq(assets.uploadedById, userId), eq(assets.uploadTaskId, task)) })
      if (existing) {
        const receipt = await tx.query.agentAssetUploads.findFirst({ where: eq(agentAssetUploads.assetId, existing.id) })
        if (!receipt || receipt.contentHash !== hash || receipt.projectId !== projectId || receipt.createRequestId !== (input.createRequestId ?? null)
          || (!input.createRequestId && existing.requirementId !== requirementId)) {
          throw createError({ statusCode: 409, message: 'uploadId 已被不同图片或目标使用', data: { code: 'IDEMPOTENCY_CONFLICT' } })
        }
        if (!existing.requirementId && receipt.expiresAt.getTime() <= Date.now()) throw createError({ statusCode: 410, message: '临时图片已过期，请使用新的 uploadId 上传' })
        return imageResult(existing)
      }
      if (input.createRequestId && await tx.query.agentSuggestions.findFirst({ where: and(eq(agentSuggestions.userId, userId), eq(agentSuggestions.requestId, input.createRequestId)) })) {
        throw createError({ statusCode: 409, message: '创建请求已提交，请通过后续编辑插入新图片' })
      }
      const id = `asset_${nanoid(12)}`, url = createAssetUrl(`${id}.${type.extension}`)
      try { await storage.put(url, file.data, type.mime) }
      catch { throw createError({ statusCode: 503, message: '图片存储暂不可用' }) }
      writtenUrl = url
      const [asset] = await tx.insert(assets).values({ id, requirementId, fileName: file.filename.split(/[\\/]/).at(-1)!.slice(0, 240),
        mimeType: type.mime, size: file.data.length, url, uploadTaskId: task, uploadedById: userId }).returning()
      await tx.insert(agentAssetUploads).values({ assetId: id, projectId, createRequestId: input.createRequestId,
        contentHash: hash, expiresAt: new Date(Date.now() + 86400_000) })
      return imageResult(asset!)
    })
  } catch (error) {
    if (writtenUrl) await storage.remove(writtenUrl).catch(() => undefined)
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 500, message: '图片上传失败，请使用同一 uploadId 重试' })
  }
}

function imageResult(asset: typeof assets.$inferSelect) {
  return { id: asset.id, url: asset.url, size: asset.size, mimeType: asset.mimeType,
    node: { type: 'image', attrs: { src: asset.url, alt: asset.fileName, align: 'center' }, content: [{ type: 'imageCaption' }] } }
}
