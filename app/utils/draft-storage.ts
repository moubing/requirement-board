import type { DraftSnapshot, LocalImageUpload } from '#shared/drafts/document'
import { localDraftSnapshotSchema } from '#shared/drafts/validation'
import type { CollaborationEdit } from '#shared/collaboration/attribution'
import { collaborationEditSchema } from '#shared/collaboration/edit-validation'

export interface LocalDraft {
  id: string
  userId: string
  requirementId: string
  formatVersion: 1
  snapshot: DraftSnapshot
  serverVersion: number
  syncedFingerprint: string
  updatedAt: string
  collaborationState?: string
  collaborationEdits?: CollaborationEdit[]
  collaborationEpoch?: number
  recoveryOnly?: boolean
}

interface LocalFile {
  key: string
  draftId: string
  userId: string
  uploadId: string
  file: Blob
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('本地草稿读取失败'))
})

function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('本地草稿写入失败'))
  })
}

export class DraftStorage {
  constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = 'requirement-board-drafts') {
    const request = factory.open(name, 1)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      let abandoned = false
      const timer = setTimeout(() => { abandoned = true; reject(new Error('本地草稿存储打开超时')) }, 5000)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('drafts', { keyPath: 'id' })
        const files = db.createObjectStore('files', { keyPath: 'key' })
        files.createIndex('draftId', 'draftId')
      }
      request.onsuccess = () => { clearTimeout(timer); if (abandoned) request.result.close(); else resolve(request.result) }
      request.onerror = () => { clearTimeout(timer); reject(request.error) }
      request.onblocked = () => { abandoned = true; clearTimeout(timer); reject(new Error('其他标签页阻止了本地草稿存储升级')) }
    })
    db.onversionchange = () => db.close()
    const storage = new DraftStorage(db)
    // API 存在不代表实际可写。必须等待测试事务完成。
    const tx = db.transaction('drafts', 'readwrite')
    const done = completed(tx)
    tx.objectStore('drafts').put({ id: '__probe__' })
    tx.objectStore('drafts').delete('__probe__')
    try { await done } catch (error) { db.close(); throw error }
    return storage
  }

  close() { this.db.close() }

  async list(userId: string, requirementId: string) {
    const rows = await requestResult(this.db.transaction('drafts').objectStore('drafts').getAll()) as LocalDraft[]
    const candidates = rows.filter(row => row.userId === userId && row.requirementId === requirementId)
    const drafts: LocalDraft[] = []
    let unreadable = 0
    for (const row of candidates) {
      const parsed = localDraftSnapshotSchema.safeParse(row.snapshot)
      if (row.formatVersion !== 1 || !parsed.success || (row.collaborationEdits !== undefined && !collaborationEditSchema.array().safeParse(row.collaborationEdits).success)) { unreadable++; continue }
      if (row.collaborationEpoch !== undefined && (!Number.isSafeInteger(row.collaborationEpoch) || row.collaborationEpoch < 0)) { unreadable++; continue }
      drafts.push({ ...row, snapshot: parsed.data })
    }
    return { drafts, unreadable }
  }

  async save(draft: LocalDraft, uploads: LocalImageUpload[]) {
    const tx = this.db.transaction(['drafts', 'files'], 'readwrite')
    const done = completed(tx)
    try {
      tx.objectStore('drafts').put(draft)
      const files = tx.objectStore('files')
      for (const upload of uploads) {
        if (!upload.file) continue
        const file = upload.file
        const key = `${draft.id}:${upload.id}`
        const exists = files.getKey(key)
        exists.onsuccess = () => {
          if (exists.result === undefined) files.put({ key, draftId: draft.id, userId: draft.userId, uploadId: upload.id, file } satisfies LocalFile)
        }
      }
    } catch (error) { tx.abort(); await done.catch(() => undefined); throw error }
    await done
  }

  async files(id: string, userId: string) {
    const rows = await requestResult(this.db.transaction('files').objectStore('files').index('draftId').getAll(id)) as LocalFile[]
    return rows.filter(row => row.userId === userId)
  }

  async remove(id: string, userId: string) {
    const tx = this.db.transaction(['drafts', 'files'], 'readwrite')
    const done = completed(tx)
    const drafts = tx.objectStore('drafts')
    const request = drafts.get(id)
    request.onsuccess = () => {
      if (request.result?.userId !== userId) return
      drafts.delete(id)
      const cursor = tx.objectStore('files').index('draftId').openCursor(IDBKeyRange.only(id))
      cursor.onsuccess = () => { const row = cursor.result; if (row) { row.delete(); row.continue() } }
    }
    await done
  }

  async pruneFiles(id: string, userId: string, keep: string[]) {
    const tx = this.db.transaction('files', 'readwrite')
    const done = completed(tx)
    const cursor = tx.objectStore('files').index('draftId').openCursor(IDBKeyRange.only(id))
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      const value = row.value as LocalFile
      if (value.userId === userId && !keep.includes(value.uploadId)) row.delete()
      row.continue()
    }
    await done
  }
}
