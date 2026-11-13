import type { Database } from '../db/client'
import type { RelatedDocumentDto } from '../../shared/requirements/relations'
import { agentRequirement } from './agent-reading'
import { changeRelatedDocuments, listRelatedDocuments } from './requirement-relations'

const summaries = (documents: RelatedDocumentDto[]) => documents.map(document => ({
  ...document, documentUrl: `/requirements/${encodeURIComponent(document.id)}`,
}))

export async function listAgentRelatedDocuments(db: Database, projectId: string, identifier: string) {
  const source = await agentRequirement(db, projectId, identifier)
  return summaries(await listRelatedDocuments(db, projectId, source.id))
}

export async function changeAgentRelatedDocuments(db: Database, projectId: string, identifier: string, targets: string[], action: 'add' | 'remove') {
  // 编号逐个解析为真实 ID；共享服务在有序行锁内再次检查整批归属和双方 AI 锁。
  const [source, ...documents] = await Promise.all([identifier, ...new Set(targets)].map(value => agentRequirement(db, projectId, value)))
  return summaries(await changeRelatedDocuments(db, projectId, source!.id, documents.map(document => document.id), action))
}
