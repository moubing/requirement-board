import { nanoid } from 'nanoid'
import { cloneDraftSnapshot, draftFingerprint, type DraftSnapshot, type DraftWrite, type StoredDraft } from '#shared/drafts/document'

// 每个编辑会话一条串行队列；失败保留原请求 ID 和快照，响应不确定时可以安全重试。
export class DraftSyncQueue {
  version = 0
  syncedFingerprint = ''
  private pending: DraftWrite | null = null
  private flight: Promise<StoredDraft> | null = null
  private lastResult: StoredDraft | null = null

  constructor(private send: (write: DraftWrite) => Promise<StoredDraft>, initial?: {
    version: number; syncedFingerprint: string; result?: StoredDraft
  }) {
    if (initial) {
      this.version = initial.version
      this.syncedFingerprint = initial.syncedFingerprint
      this.lastResult = initial.result ?? null
    }
  }

  async sync(snapshot: DraftSnapshot): Promise<StoredDraft> {
    if (this.flight) {
      await this.flight
      return this.sync(snapshot)
    }
    if (this.lastResult && !this.pending && draftFingerprint(snapshot) === this.syncedFingerprint) return this.lastResult
    if (!this.pending) this.pending = { expectedVersion: this.version, mutationId: nanoid(24), snapshot: cloneDraftSnapshot(snapshot) }
    const request = this.pending
    const flight = this.send(request).then(result => {
      this.version = result.version
      this.syncedFingerprint = draftFingerprint(request.snapshot)
      this.pending = null
      this.lastResult = result
      return result
    }).catch(error => {
      // 明确未写入的请求不能永久堵住队列，例如标题过长后用户已经修正。
      if ([400, 401, 403, 404, 413, 422].includes(error?.statusCode)) this.pending = null
      throw error
    })
    this.flight = flight
    let result: StoredDraft
    try { result = await flight } finally { this.flight = null }
    // 前一次失败的请求可能比本次调用旧；确认旧请求之后再发本次快照。
    if (draftFingerprint(snapshot) !== this.syncedFingerprint) return this.sync(snapshot)
    return result
  }
}
