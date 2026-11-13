import { z } from 'zod'
import { MAX_ANNOTATIONS } from './annotations'

export const ANNOTATION_COMPLETION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export const annotationCompletionsSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()).min(1).max(MAX_ANNOTATIONS).refine(items => new Set(items.map(item => item.id)).size === items.length, '标注 ID 不能重复')
