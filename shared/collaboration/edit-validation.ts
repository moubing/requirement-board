import { z } from 'zod'

const encoded = z.string().min(1).max(24 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/)
export const collaborationEditSchema = z.object({
  id: z.string().regex(/^edit_[a-zA-Z0-9_-]{16,64}$/),
  clientId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  update: encoded,
  intent: z.enum(['edit', 'restore', 'legacy']),
}).strict()

export const collaborationEditsSchema = z.object({
  schemaVersion: z.number().int().optional(),
  schemaCapabilities: z.array(z.string().max(64)).max(20).optional(),
  // Existing clients and IndexedDB records predate epochs and belong to epoch 0 only.
  editEpoch: z.number().int().nonnegative().default(0),
  edits: z.array(collaborationEditSchema).min(1).max(100),
  stateVector: encoded.optional(),
}).strict()
