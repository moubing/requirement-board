import { cloneRichTextDocument, type RichTextDocument } from '../editor/document'

export interface DraftImageUpload {
  id: string
  imageDiffId: string
  fileName: string
  mimeType: string
  size: number
  position: number
  order: number
  relativePosition?: string
}

export interface LocalImageUpload extends DraftImageUpload {
  file?: Blob
}

export interface DraftSnapshot {
  baseRevisionId: string
  title: string
  contentJson: RichTextDocument
  changeNote: string
  pendingUploads: DraftImageUpload[]
}

export interface StoredDraft extends DraftSnapshot {
  id: string
  requirementId: string
  userId: string
  version: number
  lastMutationId: string | null
  updatedAt: string
  closedAt: string | null
}

export interface DraftWrite {
  expectedVersion?: number
  mutationId: string
  snapshot: DraftSnapshot
}

export function cloneDraftSnapshot(snapshot: DraftSnapshot): DraftSnapshot {
  return {
    baseRevisionId: snapshot.baseRevisionId,
    title: snapshot.title,
    contentJson: cloneRichTextDocument(snapshot.contentJson),
    changeNote: snapshot.changeNote,
    pendingUploads: snapshot.pendingUploads.map(({ id, imageDiffId, fileName, mimeType, size, position, order, relativePosition }) =>
      ({ id, imageDiffId, fileName, mimeType, size, position, order, ...(relativePosition ? { relativePosition } : {}) })),
  }
}

export function draftFingerprint(snapshot: DraftSnapshot) {
  // 序列化不修改正文；仅投影持久化字段，避免先完整克隆正文再遍历一次。
  const { baseRevisionId, title, contentJson, changeNote } = snapshot
  const pendingUploads = snapshot.pendingUploads.map(({ id, imageDiffId, fileName, mimeType, size, position, order, relativePosition }) =>
    ({ id, imageDiffId, fileName, mimeType, size, position, order, ...(relativePosition ? { relativePosition } : {}) }))
  return JSON.stringify({ baseRevisionId, title, contentJson, changeNote, pendingUploads }, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
    }
    return value
  })
}

export function draftError(error: unknown) {
  const value = error as { data?: { message?: string; statusMessage?: string }; message?: string }
  return value?.data?.message || value?.data?.statusMessage || value?.message || '草稿保存失败，请重试'
}
