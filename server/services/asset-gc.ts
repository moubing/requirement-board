import { eq, isNull, sql } from 'drizzle-orm'

import type { RichTextDocument, RichTextNode } from '../../shared/editor/document'
import type { Database } from '../db/client'
import { agentAssetUploads, agentSnapshots, agentSuggestions, assets, documentTemplates, requirementCollaborationDocuments, requirementDraftAssets, requirementDrafts, requirementRevisions } from '../db/schema'
import type { AssetStorage } from './asset-storage'
import { lockAssetReferences } from './asset-references'

export const DEFAULT_ASSET_GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export interface AssetGcOptions {
  storage: AssetStorage
  graceMs?: number
  now?: Date
  dryRun?: boolean
}

export interface AssetGcResult {
  cutoff: Date
  scanned: number
  referenced: number
  candidates: string[]
  deleted: string[]
  dryRun: boolean
}

export function collectReferencedAssetUrls(documents: RichTextDocument[]) {
  const urls = new Set<string>()

  const visit = (node: RichTextNode) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src) {
      urls.add(node.attrs.src)
    }
    node.content?.forEach(visit)
  }

  for (const document of documents) document.content.forEach(visit)
  return urls
}

export async function garbageCollectAssets(db: Database, options: AssetGcOptions): Promise<AssetGcResult> {
  const graceMs = options.graceMs ?? DEFAULT_ASSET_GC_GRACE_MS
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('Asset GC grace period must not be negative')

  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - graceMs)
  const dryRun = options.dryRun ?? false

  return db.transaction(async (tx) => {
    await lockAssetReferences(tx, true)

    const candidates = await tx.select().from(assets).where(sql`coalesce(${assets.unreferencedAt}, ${assets.createdAt}) <= ${cutoff.toISOString()}::timestamptz`)
    const revisions = await tx.select({ contentJson: requirementRevisions.contentJson }).from(requirementRevisions)
    const templates = await tx.select({ contentJson: documentTemplates.contentJson }).from(documentTemplates)
    const drafts = await tx.select({ contentJson: requirementDrafts.contentJson }).from(requirementDrafts).where(isNull(requirementDrafts.closedAt))
    const collaborative = await tx.select({ contentJson: requirementCollaborationDocuments.contentJson }).from(requirementCollaborationDocuments)
    // Unused read snapshots expire after 24h, then retain their assets for the normal GC grace period.
    // 执行收据及历史审核记录的候选与基线仍是不可变历史，包括已取消的请求。
    const expiredSnapshot = sql`${agentSnapshots.expiresAt} <= ${cutoff.toISOString()}::timestamptz and not exists (select 1 from ${agentSuggestions} where ${agentSuggestions.snapshotId} = ${agentSnapshots.id})`
    if (!dryRun) await tx.delete(agentSnapshots).where(expiredSnapshot)
    const snapshots = await tx.select({ contentJson: agentSnapshots.contentJson }).from(agentSnapshots).where(sql`not (${expiredSnapshot})`)
    const suggestions = await tx.select({ contentJson: agentSuggestions.contentJson }).from(agentSuggestions)
    const pending = await tx.select({ assetId: requirementDraftAssets.assetId }).from(requirementDraftAssets)
      .innerJoin(requirementDrafts, eq(requirementDraftAssets.draftId, requirementDrafts.id)).where(isNull(requirementDrafts.closedAt))
    const agentUploads = await tx.select({ assetId: agentAssetUploads.assetId }).from(agentAssetUploads)
      .where(sql`${agentAssetUploads.expiresAt} > ${cutoff.toISOString()}::timestamptz`)
    const protectedIds = new Set([...pending, ...agentUploads].map(link => link.assetId))
    const referencedUrls = collectReferencedAssetUrls([...templates, ...revisions, ...drafts, ...collaborative, ...snapshots, ...suggestions].map(row => row.contentJson))
    const garbage = candidates.filter(asset => !referencedUrls.has(asset.url) && !protectedIds.has(asset.id))

    if (!dryRun) {
      for (const asset of garbage) {
        await options.storage.remove(asset.url)
        await tx.delete(assets).where(eq(assets.id, asset.id))
      }
    }

    return {
      cutoff,
      scanned: candidates.length,
      referenced: candidates.length - garbage.length,
      candidates: garbage.map((asset) => asset.id),
      deleted: dryRun ? [] : garbage.map((asset) => asset.id),
      dryRun,
    }
  })
}
