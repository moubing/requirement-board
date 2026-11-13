import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import type { DraftWrite } from '../../shared/drafts/document'
import { draftFingerprint } from '../../shared/drafts/document'
import { createEmptyDocument } from '../../shared/editor/document'
import type { Database, Transaction } from '../db/client'
import { agentAssetUploads, assets, requirementDraftAssets, requirementDrafts, requirementRevisions, requirements } from '../db/schema'
import { lockAssetReferences } from './asset-references'
import { collectReferencedAssetUrls } from './asset-gc'

export async function requireDraftRequirement(db: Database | Transaction, requirementId: string, projectId: string) {
  const [requirement] = await db.select().from(requirements)
    .where(and(eq(requirements.id, requirementId), eq(requirements.projectId, projectId)))
  if (!requirement) throw createError({ statusCode: 404, message: '需求不存在' })
  return requirement
}

export async function lockDraft(tx: Transaction, draftId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`draft:${draftId}`}))`)
}

export async function ownedDraft(tx: Database | Transaction, id: string, requirementId: string, userId: string) {
  const [draft] = await tx.select().from(requirementDrafts).where(eq(requirementDrafts.id, id))
  if (draft && (draft.userId !== userId || draft.requirementId !== requirementId)) {
    throw createError({ statusCode: 404, message: '草稿不存在' })
  }
  return draft
}

export async function writeDraft(db: Database, requirementId: string, projectId: string, userId: string, id: string, input: DraftWrite) {
  return db.transaction(async tx => {
    await lockAssetReferences(tx)
    await lockDraft(tx, id)
    await requireDraftRequirement(tx, requirementId, projectId)
    const current = await ownedDraft(tx, id, requirementId, userId)
    if (current?.closedAt) throw createError({ statusCode: 410, message: '这份草稿已结束' })
    if (current?.lastMutationId === input.mutationId && draftFingerprint(current) === draftFingerprint(input.snapshot)) return current
    const [base] = await tx.select({ id: requirementRevisions.id }).from(requirementRevisions)
      .where(and(eq(requirementRevisions.id, input.snapshot.baseRevisionId), eq(requirementRevisions.requirementId, requirementId)))
    if (!base) throw createError({ statusCode: 400, message: '草稿基准版本无效' })
    const values = {
      ...input.snapshot,
      version: (current?.version ?? 0) + 1,
      lastMutationId: input.mutationId,
      updatedAt: new Date(),
    }
    // 检查站内图片仍然存在，避免恢复时将已清理的 URL 误报为同步成功。
    await assertDraftImages(tx, values.contentJson, projectId)
    const [saved] = current
      ? await tx.update(requirementDrafts).set(values).where(eq(requirementDrafts.id, id)).returning()
      : await tx.insert(requirementDrafts).values({ id, requirementId, userId, ...values }).returning()
    return saved!
  })
}

export async function assertDraftImages(tx: Transaction, document: import('../../shared/editor/document').RichTextDocument, projectId: string,
  staging?: { userId: string; requestId: string; frozen?: boolean }) {
  const urls = new Set<string>()
  const visit = (node: import('../../shared/editor/document').RichTextNode) => {
    const src = node.type === 'image' ? node.attrs?.src : undefined
    if (typeof src === 'string' && src.startsWith('/uploads/')) urls.add(src)
    node.content?.forEach(visit)
  }
  document.content.forEach(visit)
  if (!urls.size) return [] as string[]
  const rows = await tx.select({ url: assets.url }).from(assets)
    .leftJoin(requirements, eq(assets.requirementId, requirements.id))
    .where(and(inArray(assets.url, [...urls]), or(eq(requirements.projectId, projectId), eq(assets.templateProjectId, projectId))))
  const staged = staging ? await tx.select({ id: assets.id, url: assets.url }).from(assets)
    .innerJoin(agentAssetUploads, eq(agentAssetUploads.assetId, assets.id))
    .where(and(inArray(assets.url, [...urls]), eq(agentAssetUploads.projectId, projectId), eq(assets.uploadedById, staging.userId),
      eq(agentAssetUploads.createRequestId, staging.requestId), sql`${assets.requirementId} is null`,
      staging.frozen ? undefined : sql`${agentAssetUploads.expiresAt} > now()`)) : []
  if (new Set([...rows, ...staged].map(row => row.url)).size !== urls.size) {
    throw createError({ statusCode: 400, message: '部分图片不存在或无权访问，请重新上传后再保存' })
  }
  return staged.map(row => row.id)
}

export async function finishDraft(tx: Transaction, draft: typeof requirementDrafts.$inferSelect) {
  const links = await tx.select().from(requirementDraftAssets).where(eq(requirementDraftAssets.draftId, draft.id))
  const urls = [...collectReferencedAssetUrls([draft.contentJson])]
  if (links.length || urls.length) await tx.update(assets).set({ unreferencedAt: new Date() }).where(or(
    inArray(assets.id, links.map(link => link.assetId)), inArray(assets.url, urls),
  ))
  await tx.delete(requirementDraftAssets).where(eq(requirementDraftAssets.draftId, draft.id))
  // 保留轻量墓碑，拒绝网络延迟导致的旧请求重新创建已丢弃草稿。
  await tx.update(requirementDrafts).set({
    title: '', contentJson: createEmptyDocument(), changeNote: '', pendingUploads: [],
    closedAt: new Date(), updatedAt: new Date(), version: draft.version + 1,
  }).where(eq(requirementDrafts.id, draft.id))
}

export async function listDrafts(db: Database, requirementId: string, userId: string) {
  const rows = await db.select().from(requirementDrafts).where(and(
    eq(requirementDrafts.requirementId, requirementId), eq(requirementDrafts.userId, userId),
  )).orderBy(desc(requirementDrafts.updatedAt))
  return { drafts: rows.filter(row => !row.closedAt), closedIds: rows.filter(row => row.closedAt).map(row => row.id) }
}
