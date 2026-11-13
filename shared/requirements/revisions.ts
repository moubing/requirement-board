import type { AttributionSnapshot, NodeContributor } from '../collaboration/attribution'
import type { RichTextDocument } from '../editor/document'

export interface RevisionMetadata {
  id: string
  requirementId: string
  version: number
  title: string
  changeNote: string
  createdAt: string
  author: { id: string; name: string; avatarColor: string }
}

export interface RevisionSummaryDto extends RevisionMetadata {
  editors: NodeContributor[]
  editorsIncomplete: boolean
}

export interface RevisionDto extends RevisionMetadata {
  contentJson: RichTextDocument
  contentText: string
  attribution?: AttributionSnapshot | null
  attributionSequence?: number | null
}

export function revisionEditors(attribution?: AttributionSnapshot | null) {
  const nodes = attribution?.nodes ?? []
  return {
    editors: [...new Map(nodes.flatMap(node => node.authors.map(author => [author.userId, author] as const))).values()],
    editorsIncomplete: !attribution || nodes.some(node => node.unknown),
  }
}
