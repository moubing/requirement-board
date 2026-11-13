import { describe, expect, it, vi } from 'vitest'
import { CollaborationEditQueue, CollaborationEditRecorder } from '../../app/utils/collaboration-edit-queue'
import type { CollaborationEdit } from '../../shared/collaboration/attribution'
import * as Y from 'yjs'
import { collaborationSnapshotSchema, createCollaborationDocument, decodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'

const event = (id: string): CollaborationEdit => ({ id, clientId: 1, update: 'AAA=', intent: 'edit' })
describe('原始编辑事件补交', () => {
  it('响应丢失后用原事件重试，不吞掉请求期间继续输入的内容', async () => {
    let reject!: (error: Error) => void
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail })).mockResolvedValue(undefined)
    const queue = new CollaborationEditQueue(send)
    queue.push(event('first'))
    const first = queue.flush()
    queue.push(event('second'))
    reject(new Error('response lost'))
    await expect(first).rejects.toThrow('response lost')
    expect(queue.snapshot().map(edit => edit.id)).toEqual(['first', 'second'])
    const restored = new CollaborationEditQueue(send, queue.snapshot())
    await restored.flush()
    expect(send.mock.calls[1]![0].map((edit: CollaborationEdit) => edit.id)).toEqual(['first', 'second'])
    expect(restored.size).toBe(0)
  })
  it('并行 flush 共用一个请求，新事件在后续批次按顺序发出', async () => {
    let complete!: () => void
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve })).mockResolvedValue(undefined)
    const queue = new CollaborationEditQueue(send)
    queue.push(event('first'))
    const first = queue.flush()
    expect(queue.flush()).toBe(first)
    queue.push(event('second'))
    complete()
    await first
    expect(send.mock.calls.map(call => call[0].map((edit: CollaborationEdit) => edit.id))).toEqual([['first'], ['second']])
    expect(queue.size).toBe(0)
  })
  it('超过一批的新增块补交时，每个编辑和其 ID 修复仍在一起', async () => {
    const sender = createCollaborationDocument({ title: '分批恢复', contentJson: { type: 'doc', content: [] } })
    const receiver = new Y.Doc()
    Y.applyUpdate(receiver, Y.encodeStateAsUpdate(sender))
    const send = vi.fn(async (batch: CollaborationEdit[]) => {
      for (const packet of batch) {
        Y.applyUpdate(receiver, decodeCollaborationState(packet.update))
        // 任意批次边界乃至单个事件都必须是完整、可接受的文档。
        expect(collaborationSnapshotSchema.safeParse(readCollaborationDocument(receiver)).success).toBe(true)
      }
    })
    const queue = new CollaborationEditQueue(send)
    const recorder = new CollaborationEditRecorder(queue)
    sender.on('update', update => recorder.record(update, sender.clientID, 'edit'))
    try {
      for (let index = 0; index < 101; index++) {
        const node = new Y.XmlElement('paragraph')
        sender.getXmlFragment('default').push([node])
        node.setAttribute('diffId', `p_${index}`)
        await Promise.resolve()
      }
      expect(queue.size).toBe(101)
      await queue.flush()
      expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([100, 1])
      expect(readCollaborationDocument(receiver)).toEqual(readCollaborationDocument(sender))
    } finally { sender.destroy(); receiver.destroy() }
  })
})
