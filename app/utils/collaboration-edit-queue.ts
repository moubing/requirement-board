import type { CollaborationEdit } from '#shared/collaboration/attribution'
import { nanoid } from 'nanoid'
import * as Y from 'yjs'

/** 同一个调用栈内的编辑和块 ID 修复合成一个原始事件，不能在分页补交时拆开。 */
export class CollaborationEditRecorder {
  private updates: Uint8Array[] = []
  private clientId = 0
  private intent: CollaborationEdit['intent'] = 'edit'

  constructor(private queue: CollaborationEditQueue) {}

  record(update: Uint8Array, clientId: number, intent: CollaborationEdit['intent']) {
    if (this.updates.length && this.clientId !== clientId) this.flush()
    this.clientId = clientId
    if (intent === 'restore') this.intent = intent
    if (!this.updates.length) queueMicrotask(() => this.flush())
    this.updates.push(update)
  }

  flush() {
    if (!this.updates.length) return
    const update = Y.mergeUpdates(this.updates)
    let binary = ''
    for (const byte of update) binary += String.fromCharCode(byte)
    const event: CollaborationEdit = { id: `edit_${nanoid(24)}`, clientId: this.clientId,
      intent: this.intent, update: btoa(binary) }
    this.updates = []
    this.intent = 'edit'
    this.queue.push(event)
  }
}

/** 保留原始事件，响应丢失时用同一个 ID 重试；绝不将重连的合并状态认领为新编辑。 */
export class CollaborationEditQueue {
  private pending: CollaborationEdit[]
  private running?: Promise<void>

  constructor(private send: (edits: CollaborationEdit[]) => Promise<void>, initial: CollaborationEdit[] = [],
    private changed: () => void = () => {}) {
    this.pending = [...initial]
  }

  get size() { return this.pending.length }
  snapshot() { return this.pending.map(edit => ({ ...edit })) }
  push(edit: CollaborationEdit) { this.pending.push(edit); this.changed() }

  flush(): Promise<void> {
    if (this.running) return this.running
    const work = async () => {
      while (this.pending.length) {
        let bytes = 0
        const batch: CollaborationEdit[] = []
        for (const edit of this.pending) {
          if (batch.length && (batch.length >= 100 || bytes + edit.update.length > 16 * 1024 * 1024)) break
          batch.push(edit)
          bytes += edit.update.length
        }
        await this.send(batch)
        this.pending.splice(0, batch.length)
        this.changed()
      }
    }
    this.running = work().finally(() => { this.running = undefined })
    return this.running
  }
}
