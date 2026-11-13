import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import sharp from 'sharp'
import type { Database } from '../db/client'
import { agentSnapshots, assets, requirementCollaborationDocuments, requirementRevisions } from '../db/schema'
import { agentRequirement } from './agent-reading'
import { activeAgentLock } from './agent-locks'
import { assertDraftImages } from './requirement-drafts'
import { parseAssetUrl, useAssetStorage } from './asset-storage'
import { agentImageType, MAX_AGENT_IMAGE_BYTES } from './agent-assets'
import type { RichTextNode } from '../../shared/editor/document'

export async function validateReadableAgentImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_AGENT_IMAGE_BYTES) throw createError({ statusCode: 413, message: '原图不能为空且不得超过 5 MiB' })
  const type = agentImageType(bytes)
  try {
    const decoder = sharp(bytes, { failOn: 'warning', pages: 1, limitInputPixels: 40_000_000 })
    const metadata = await decoder.metadata()
    if (!['png', 'jpeg', 'gif', 'webp'].includes(metadata.format ?? '')) throw new Error('unsupported')
    // metadata 只解析头；完整解码首帧，拒绝只有合法文件头的损坏文件。
    await decoder.stats()
    return { ...type, width: metadata.width, height: metadata.pageHeight ?? metadata.height,
      firstFrameOnly: type.extension === 'gif' || type.extension === 'webp' }
  } catch { throw createError({ statusCode: 422, message: '原图损坏、无法解码或超过 4000 万像素读取限制' }) }
}

export async function readAgentImage(db: Database, projectId: string, userId: string, tokenId: string,
  identifier: string, diffId: string, snapshotId?: string) {
  const url = await db.transaction(async tx => {
    const requirement = await agentRequirement(tx, projectId, identifier)
    let document
    if (snapshotId) {
      const snapshot = await tx.query.agentSnapshots.findFirst({ where: and(eq(agentSnapshots.id, snapshotId),
        eq(agentSnapshots.requirementId, requirement.id), eq(agentSnapshots.userId, userId)) })
      const active = await activeAgentLock(tx, requirement.id)
      if (!snapshot || snapshot.expiresAt.getTime() <= Date.now() || active?.lock.snapshotId !== snapshotId || active.lock.tokenId !== tokenId) {
        throw createError({ statusCode: 409, message: '原图读取快照或编辑锁已失效，请重新读取', data: { code: 'AGENT_LOCK_LOST' } })
      }
      document = snapshot.contentJson
    } else {
      const current = await tx.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirement.id) })
      const latest = current ? undefined : await tx.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.requirementId, requirement.id), orderBy: desc(requirementRevisions.version) })
      document = (current ?? latest)?.contentJson
    }
    const images: RichTextNode[] = []
    function visit(node: RichTextNode) {
      if (node.type === 'image' && node.attrs?.diffId === diffId) images.push(node)
      node.content?.forEach(visit)
    }
    document?.content.forEach(visit)
    if (images.length !== 1) throw createError({ statusCode: 404, message: '此文档中没有唯一对应的图片引用' })
    const image = images[0]!, src = image.attrs?.src
    // 必须是本站托管路径，不能把 PAT 或站外地址交给存储驱动。
    if (typeof src !== 'string' || !src.startsWith('/uploads/') || !parseAssetUrl(src)) throw createError({ statusCode: 415, message: '原图读取只支持本站托管的 PNG、JPEG、GIF、WebP，不读取站外图片' })
    await assertDraftImages(tx, { type: 'doc', content: [image] }, projectId)
    const asset = await tx.query.assets.findFirst({ where: eq(assets.url, src) })
    if (!asset) throw createError({ statusCode: 404, message: '图片资源不存在' })
    if (asset.size > MAX_AGENT_IMAGE_BYTES) throw createError({ statusCode: 413, message: '原图不得超过 5 MiB' })
    return src
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
  const object = await useAssetStorage().get(url).catch(() => { throw createError({ statusCode: 503, message: '原图存储暂不可用' }) })
  if (!object) throw createError({ statusCode: 404, message: '原图文件不存在' })
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of object.body) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_AGENT_IMAGE_BYTES) throw createError({ statusCode: 413, message: '原图不得超过 5 MiB' })
      chunks.push(bytes)
    }
  } finally { object.body.destroy() }
  const bytes = Buffer.concat(chunks)
  return { bytes, ...await validateReadableAgentImage(bytes) }
}
