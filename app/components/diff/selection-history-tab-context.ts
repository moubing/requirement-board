import type { RichTextDocument } from '~~/shared/editor/document'
import type { SelectionHistoryAnchor } from '~~/shared/diff/selection-history'
import { isAttributionSnapshot, type AttributionSnapshot } from '#shared/collaboration/attribution'

const STORAGE_PREFIX = 'requirement-board:selection-history:'
const CONTEXT_VERSION = 1
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export interface SelectionHistoryTabContext {
  requirementId: string
  anchor: SelectionHistoryAnchor
  draftDocument: RichTextDocument
  currentUserName: string
  capturedAt: string
  attribution?: AttributionSnapshot | null
  attributionPending?: boolean
}

interface StoredSelectionHistoryTabContext {
  version: typeof CONTEXT_VERSION
  expiresAt: number
  context: SelectionHistoryTabContext
}

export type ReadSelectionHistoryTabContextResult =
  | { ok: true; context: SelectionHistoryTabContext }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'requirement-mismatch' }

export function createSelectionHistoryContextToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function selectionHistoryContextStorageKey(token: string) {
  return `${STORAGE_PREFIX}${token}`
}

export function writeSelectionHistoryTabContext(
  storage: Storage,
  token: string,
  context: SelectionHistoryTabContext,
  options: { now?: number; ttlMs?: number } = {},
) {
  const now = options.now ?? Date.now()
  const stored: StoredSelectionHistoryTabContext = {
    version: CONTEXT_VERSION,
    expiresAt: now + (options.ttlMs ?? DEFAULT_TTL_MS),
    context,
  }

  pruneExpiredSelectionHistoryContexts(storage, now)
  storage.setItem(selectionHistoryContextStorageKey(token), JSON.stringify(stored))
}

export function readSelectionHistoryTabContext(
  sharedStorage: Storage,
  tabStorage: Storage,
  token: string,
  requirementId: string,
  options: { now?: number } = {},
): ReadSelectionHistoryTabContextResult {
  const key = selectionHistoryContextStorageKey(token)
  const fromTab = tabStorage.getItem(key)
  const serialized = fromTab ?? sharedStorage.getItem(key)

  if (!serialized) return { ok: false, reason: 'missing' }

  let stored: unknown
  try {
    stored = JSON.parse(serialized)
  } catch {
    removeSelectionHistoryTabContext(sharedStorage, tabStorage, token)
    return { ok: false, reason: 'invalid' }
  }

  if (!isStoredContext(stored)) {
    removeSelectionHistoryTabContext(sharedStorage, tabStorage, token)
    return { ok: false, reason: 'invalid' }
  }

  if (stored.expiresAt <= (options.now ?? Date.now())) {
    removeSelectionHistoryTabContext(sharedStorage, tabStorage, token)
    return { ok: false, reason: 'expired' }
  }

  if (stored.context.requirementId !== requirementId) {
    removeSelectionHistoryTabContext(sharedStorage, tabStorage, token)
    return { ok: false, reason: 'requirement-mismatch' }
  }

  if (!fromTab) {
    tabStorage.setItem(key, serialized)
    sharedStorage.removeItem(key)
  }

  return { ok: true, context: stored.context }
}

export function removeSelectionHistoryTabContext(
  sharedStorage: Storage,
  tabStorage: Storage | null,
  token: string,
) {
  const key = selectionHistoryContextStorageKey(token)
  sharedStorage.removeItem(key)
  tabStorage?.removeItem(key)
}

function pruneExpiredSelectionHistoryContexts(storage: Storage, now: number) {
  const expiredKeys: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(STORAGE_PREFIX)) continue

    const serialized = storage.getItem(key)
    if (!serialized) continue

    try {
      const stored = JSON.parse(serialized) as { expiresAt?: unknown }
      if (typeof stored.expiresAt !== 'number' || stored.expiresAt <= now) {
        expiredKeys.push(key)
      }
    } catch {
      expiredKeys.push(key)
    }
  }

  expiredKeys.forEach((key) => storage.removeItem(key))
}

function isStoredContext(value: unknown): value is StoredSelectionHistoryTabContext {
  if (!isRecord(value) || value.version !== CONTEXT_VERSION || typeof value.expiresAt !== 'number') {
    return false
  }

  const context = value.context
  if (!isRecord(context)) return false
  // 已打开的旧标签页仍可查看正文；旧逐字来源不冒充节点修改人。
  if (isRecord(context.attribution) && context.attribution.version === 1) context.attribution = null
  if (
    typeof context.requirementId !== 'string'
    || typeof context.currentUserName !== 'string'
    || typeof context.capturedAt !== 'string'
    || !isSelectionAnchor(context.anchor)
    || !isRichTextDocument(context.draftDocument)
    || (context.attribution != null && !isAttributionSnapshot(context.attribution))
    || (context.attributionPending !== undefined && typeof context.attributionPending !== 'boolean')
  ) {
    return false
  }

  return true
}

function isSelectionAnchor(value: unknown): value is SelectionHistoryAnchor {
  if (!isRecord(value) || typeof value.text !== 'string') return false
  if (value.scope !== 'selection' && value.scope !== 'block') return false
  if (!Array.isArray(value.segments) || !value.segments.length) return false

  return value.segments.every((segment) =>
    isRecord(segment)
    && typeof segment.blockId === 'string'
    && typeof segment.blockType === 'string'
    && typeof segment.start === 'number'
    && Number.isInteger(segment.start)
    && segment.start >= 0
    && typeof segment.end === 'number'
    && Number.isInteger(segment.end)
    && segment.end >= segment.start
    && typeof segment.text === 'string',
  )
}

function isRichTextDocument(value: unknown): value is RichTextDocument {
  return isRecord(value) && value.type === 'doc' && Array.isArray(value.content)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
