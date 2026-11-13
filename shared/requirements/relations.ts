import { z } from 'zod'
import type { DocumentType } from '../documents/workflow'

export const MAX_RELATED_DOCUMENT_SELECTION = 100
export const addRelatedDocumentsSchema = z.object({
  documentIds: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_RELATED_DOCUMENT_SELECTION),
}).strict()

export interface RelatedDocumentDto {
  id: string
  key: string
  title: string
  documentType: DocumentType
  status: { id: string; code: string; name: string; color: string }
}
