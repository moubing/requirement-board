import { and, desc, eq, inArray, or, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { nanoid } from 'nanoid'
import type { Database, Transaction } from '../db/client'
import { assets, documentTemplates, requirements } from '../db/schema'
import { builtInTemplates, documentTemplateInputSchema, type DocumentTemplate } from '../../shared/documents/templates'
import { ensureBlockIds } from '../../shared/editor/document'
import { lockAssetReferences } from './asset-references'
import { collectReferencedAssetUrls } from './asset-gc'
import { documentWriteReceipt } from './document-write-receipts'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'

type Actor = { projectId: string; userId: string; admin: boolean }
export async function getDocumentTemplate(db: Database | Transaction, projectId: string, id: string): Promise<DocumentTemplate> {
  const builtIn = builtInTemplates().find(item => item.id === id)
  if (builtIn) return builtIn
  const row = await db.query.documentTemplates.findFirst({ where: and(eq(documentTemplates.id, id), eq(documentTemplates.projectId, projectId)) })
  if (!row) throw createError({ statusCode: 404, message: '模板不存在' })
  return { ...row, builtIn: false, canEdit: false }
}
export async function listDocumentTemplates(db: Database, actor: Actor) {
  const rows = await db.query.documentTemplates.findMany({ where: eq(documentTemplates.projectId, actor.projectId), orderBy: desc(documentTemplates.updatedAt) })
  return [...builtInTemplates(), ...rows.map(row => ({ ...row, builtIn: false, canEdit: actor.admin || row.createdBy === actor.userId }))]
}
export async function saveDocumentTemplate(db: Database, actor: Actor, body: unknown, id?: string, version?: number, requestId?: string) {
  if (Buffer.byteLength(JSON.stringify(body)) > 4 * 1024 * 1024) throw createError({ statusCode: 413, message: '模板不能超过 4 MiB' })
  const parsed = documentTemplateInputSchema.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, message: '模板信息或正文格式无效', data: { issues: parsed.error.issues } })
  const input = { ...parsed.data, contentJson: normalizeTrailingParagraph(ensureBlockIds(structuredClone(parsed.data.contentJson))) }
  return db.transaction(async tx => {
    const receipt = await documentWriteReceipt(tx, { projectId: actor.projectId, userId: actor.userId }, requestId, 'template.save', { id, version, input: parsed.data })
    if (receipt.resourceId) {
      const current = await getDocumentTemplate(tx, actor.projectId, receipt.resourceId)
      return { ...current, canEdit: actor.admin || (await tx.query.documentTemplates.findFirst({ where: eq(documentTemplates.id, receipt.resourceId) }))?.createdBy === actor.userId }
    }
    await lockAssetReferences(tx)
    let previousUrls = new Set<string>()
    if (id) {
      const [current] = await tx.select().from(documentTemplates).where(and(eq(documentTemplates.id, id), eq(documentTemplates.projectId, actor.projectId))).for('update')
      if (!current) throw createError({ statusCode: 404, message: '模板不存在；内置模板请复制后编辑' })
      if (!actor.admin && current.createdBy !== actor.userId) throw createError({ statusCode: 403, message: '只有创建者和管理员可以维护模板' })
      if (current.version !== version) throw createError({ statusCode: 409, message: '模板已被其他人修改，请重新载入后再保存；当前输入已保留' })
      previousUrls = collectReferencedAssetUrls([current.contentJson])
    }
    const urls = [...collectReferencedAssetUrls([input.contentJson])].filter(url => url.startsWith('/uploads/'))
    if (urls.length) {
      const rows = await tx.select({ id: assets.id, url: assets.url }).from(assets).leftJoin(requirements, eq(requirements.id, assets.requirementId))
        .where(and(inArray(assets.url, urls), or(eq(requirements.projectId, actor.projectId), eq(assets.templateProjectId, actor.projectId),
          and(isNull(assets.requirementId), isNull(assets.templateProjectId), eq(assets.uploadedById, actor.userId)))))
      if (new Set(rows.map(row => row.url)).size !== urls.length) throw createError({ statusCode: 400, message: '模板包含不存在或无权使用的图片' })
      await tx.update(assets).set({ templateProjectId: actor.projectId, unreferencedAt: null }).where(inArray(assets.id, rows.map(row => row.id)))
    }
    const removedUrls = [...previousUrls].filter(url => !urls.includes(url))
    if (removedUrls.length) await tx.update(assets).set({ unreferencedAt: new Date() }).where(inArray(assets.url, removedUrls))
    const [saved] = id
      ? await tx.update(documentTemplates).set({ ...input, version: version! + 1, updatedAt: new Date() }).where(eq(documentTemplates.id, id)).returning()
      : await tx.insert(documentTemplates).values({ ...input, id: `template_${nanoid(16)}`, projectId: actor.projectId, createdBy: actor.userId }).returning()
    await receipt.complete(saved!.id)
    return { ...saved!, builtIn: false, canEdit: true }
  })
}
