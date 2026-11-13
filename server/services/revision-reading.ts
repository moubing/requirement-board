import { desc, eq } from 'drizzle-orm'
import { isAttributionSnapshot } from '../../shared/collaboration/attribution'
import { revisionEditors, type RevisionSummaryDto } from '../../shared/requirements/revisions'
import type { Database } from '../db/client'
import { requirementRevisions } from '../db/schema'
import { revisionNodeContributions } from './node-contributions'

export async function listRevisionSummaries(db: Database, requirementId: string): Promise<RevisionSummaryDto[]> {
  const revisions = await db.query.requirementRevisions.findMany({
    where: eq(requirementRevisions.requirementId, requirementId),
    columns: { id: true, requirementId: true, version: true, title: true, changeNote: true, createdAt: true,
      attribution: true, attributionSequence: true },
    with: { author: { columns: { id: true, name: true, avatarColor: true } } },
    orderBy: desc(requirementRevisions.version),
  })
  return Promise.all(revisions.map(async revision => {
    let attribution = isAttributionSnapshot(revision.attribution) ? revision.attribution : null
    // 仅旧版逐字来源需要正文与收据重建名单；不改写历史，也不把节点记录放入列表响应。
    if (revision.attribution?.version === 1 && revision.attributionSequence !== null) {
      const legacy = await db.query.requirementRevisions.findFirst({ where: eq(requirementRevisions.id, revision.id) })
      if (legacy) attribution = (await revisionNodeContributions(db, legacy)).attribution
    }
    return { id: revision.id, requirementId: revision.requirementId, version: revision.version, title: revision.title,
      changeNote: revision.changeNote, createdAt: revision.createdAt.toISOString(), author: revision.author,
      ...revisionEditors(attribution) }
  }))
}
