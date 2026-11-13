import { and, desc, eq, lte } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { Database, Transaction } from '../db/client'
import { requirementCollaborationDocuments, requirementRevisions, requirements } from '../db/schema'
import { agentContentToken, agentRequirement } from './agent-reading'
import { agentDiff } from '../../shared/agent/diff'
import { buildSelectionHistory, extractSelectionHistoryBlocks, type SelectionHistoryConfidence, type SelectionHistorySegment, type SelectionHistorySegmentStatus, type SelectionHistoryVersion } from '../../shared/diff/selection-history'
import { currentNodeContributions, revisionNodeContributions } from './node-contributions'
import type { z } from 'zod'
import type { diffQuerySchema, historyQuerySchema } from '../utils/agent-query'

async function resolveVersion(tx: Transaction, requirementId: string, ref: string) {
  const metadata = ref === 'draft' ? await tx.query.requirements.findFirst({ where: eq(requirements.id, requirementId), columns: { title: true } }) : undefined
  if (ref === 'draft') {
    const current = await tx.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, requirementId), columns: { title: true, contentJson: true } })
    if (current) return { id: 'draft', version: null, title: metadata!.title, contentJson: current.contentJson, createdAt: null, savedBy: null, changeNote: null }
  }
  const revision = await tx.query.requirementRevisions.findFirst({ where: and(eq(requirementRevisions.requirementId, requirementId),
    /^v\d+$/.test(ref) ? eq(requirementRevisions.version, Number(ref.slice(1))) : ref.startsWith('rev_') ? eq(requirementRevisions.id, ref) : undefined),
    orderBy: desc(requirementRevisions.version), with: { author: { columns: { id: true, name: true } } } })
  if (!revision) throw createError({ statusCode: 404, message: '版本不存在或不属于此需求' })
  return { id: ref === 'draft' ? 'draft' : revision.id, version: ref === 'draft' ? null : revision.version,
    title: metadata?.title ?? revision.title, contentJson: revision.contentJson, createdAt: ref === 'draft' ? null : revision.createdAt,
    savedBy: ref === 'draft' ? null : revision.author, changeNote: ref === 'draft' ? null : revision.changeNote }
}

export async function showAgentVersion(db: Database, projectId: string, identifier: string, ref: string) {
  return db.transaction(async tx => {
    const row = await agentRequirement(tx, projectId, identifier)
    return { requirementId: row.id, key: row.key, ...await resolveVersion(tx, row.id, ref) }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function compareAgentVersions(db: Database, projectId: string, identifier: string, query: z.output<typeof diffQuerySchema>) {
  return db.transaction(async tx => {
    const row = await agentRequirement(tx, projectId, identifier)
    const base = await resolveVersion(tx, row.id, query.from), target = await resolveVersion(tx, row.id, query.to)
    const token = createHash('sha256').update(JSON.stringify([row.id, base.id, await agentContentToken(base), target.id, await agentContentToken(target)])).digest('hex')
    if ((query.offset && !query.comparisonToken) || (query.comparisonToken && query.comparisonToken !== token)) {
      throw createError({ statusCode: 409, message: '比较内容已变化，请从第一页重新比较', data: { code: 'DIFF_CHANGED' } })
    }
    const diff = agentDiff(base, target)
    const metadata = ({ contentJson: _, ...rest }: typeof base) => rest
    const end = query.offset + query.limit
    return { requirementId: row.id, key: row.key, base: metadata(base), target: metadata(target), comparisonToken: token,
      counts: diff.counts, title: diff.title, total: diff.blocks.length,
      blocks: query.stat === 'true' ? [] : diff.blocks.slice(query.offset, end),
      nextOffset: query.stat !== 'true' && end < diff.blocks.length ? end : null }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

function historyEvidence(status: SelectionHistorySegmentStatus, confidence: SelectionHistoryConfidence, hasBase: boolean, truncated: boolean) {
  if (!hasBase) return truncated
    ? { status: 'history_boundary', explanation: '已到本次查询的版本上限；更早版本未纳入查询，不能据此确认首次出现。' }
    : { status, explanation: '在最早可用版本中已存在这段内容；该版本的保存人和保存时间不能证明原作者或输入时间。' }
  if (confidence === 'lost') return { status: 'tracking_lost', explanation: '该版本已找到内容，但无法可靠对应到更早版本，追溯在此中断；这不是查询失败，也不能据此确认首次出现、原作者或创作时间。' }
  return { status, explanation: confidence === 'inferred'
    ? '与更早版本的对应关系由相似内容推断，所列变化需要结合上下文核对。'
    : '已通过同一块定位并比较相邻版本；节点参与者仍不等于所选文字的逐字作者。' }
}

export async function agentTextHistory(db: Database, projectId: string, identifier: string, query: z.output<typeof historyQuerySchema>) {
  return db.transaction(async tx => {
    const row = await agentRequirement(tx, projectId, identifier)
    const at = await resolveVersion(tx, row.id, query.at)
    const revisions = await tx.query.requirementRevisions.findMany({ where: and(eq(requirementRevisions.requirementId, row.id),
      at.version === null ? undefined : lte(requirementRevisions.version, at.version)), orderBy: desc(requirementRevisions.version), limit: 201,
      with: { author: { columns: { id: true, name: true } } } })
    const truncated = revisions.length > 200
    const versions: SelectionHistoryVersion[] = []
    if (at.id === 'draft') {
      const current = await tx.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, row.id) })
      versions.push({ id: 'draft', label: '当前草稿', version: null, document: at.contentJson, draft: true,
        attribution: current ? await currentNodeContributions(tx, current) : null })
    }
    for (const revision of revisions.slice(0, 200)) versions.push({ id: revision.id, label: `v${revision.version}`, version: revision.version,
      document: revision.contentJson, author: revision.author.name, createdAt: revision.createdAt.toISOString(), changeNote: revision.changeNote,
      attribution: (await revisionNodeContributions(tx, revision)).attribution })
    const matches = extractSelectionHistoryBlocks(at.contentJson).flatMap<SelectionHistorySegment & { context?: string }>(block => {
      if (query.block && block.id !== query.block) return []
      const needle = query.text
      if (!needle) return [{ blockId: block.id, blockType: block.type, start: 0, end: block.tokens.length, text: block.text, wholeBlock: true }]
      const found = []
      let offset = 0
      while (offset <= block.text.length) {
        const index = block.text.indexOf(needle, offset)
        if (index < 0) break
        const start = Array.from(block.text.slice(0, index)).length
        if (query.start === undefined || start === query.start) found.push({ blockId: block.id, blockType: block.type, start,
          end: start + Array.from(needle).length, text: needle, context: block.text.slice(Math.max(0, index - 60), index + needle.length + 60) })
        offset = index + Math.max(1, needle.length)
      }
      return found
    })
    const common = { requirementId: row.id, key: row.key, at: { id: at.id, version: at.version },
      attributionScope: 'node_participants_per_version', timeMeaning: 'version_saved_at',
      note: '保存人和保存时间不等于原作者和输入时间；参与者按整个节点统计。推断或丢失定位不能证明首次创作。' }
    if (matches.length !== 1) return { ...common, status: matches.length ? 'ambiguous' : 'not_found', matches: matches.slice(0, 50), matchCount: matches.length, entries: [] }
    const history = buildSelectionHistory({ text: matches[0]!.text, scope: query.text ? 'selection' : 'block', segments: [matches[0]!] }, versions)
    const entries = history.changedEntries.map(entry => ({
      revisionId: entry.target.id, version: entry.target.version, savedBy: entry.target.author ?? null, savedAt: entry.target.createdAt ?? null,
      changeNote: entry.target.changeNote ?? null, confidence: entry.confidence,
      comparedTo: entry.base ? { revisionId: entry.base.id, version: entry.base.version } : null,
      ...historyEvidence(entry.status, entry.confidence, !!entry.base, truncated),
      segments: entry.segments.map(segment => ({ blockId: segment.targetBlockId,
        ...historyEvidence(segment.status, segment.confidence, !!entry.base, truncated),
        confidence: segment.confidence, before: segment.baseChunks.map(c => c.value).join(''), after: segment.targetChunks.map(c => c.value).join(''),
        beforeChunks: segment.baseChunks, afterChunks: segment.targetChunks,
        participants: entry.target.attribution?.nodes.find(node => node.id === segment.targetBlockId)?.authors ?? [],
        participantsUnknown: !entry.target.attribution || (entry.target.attribution.nodes.find(node => node.id === segment.targetBlockId)?.unknown ?? false),
      })),
    }))
    return { ...common, status: 'found', match: matches[0], entries, truncated,
      oldestExaminedVersion: versions.at(-1)?.version ?? null }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
