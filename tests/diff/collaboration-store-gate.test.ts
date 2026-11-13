import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import { acceptCollaborationEdits, exclusiveDocument, requireDocumentSchema } from '../../server/services/collaboration'
import { createCollaborationDocument } from '../../shared/collaboration/document'
import type { Database } from '../../server/db/client'

// 服务端由 Nitro 提供 h3；这个用例只验证存储回调的锁顺序。
vi.mock('h3', () => ({ createError: (details: { message?: string }) => new Error(details.message) }))

afterEach(() => vi.restoreAllMocks())

describe('原始编辑确认与协作存储的锁顺序', () => {
  it('HTTP 与 WebSocket 共用节点能力校验，旧 schema 3 页面必须刷新', () => {
    for (const capabilities of [undefined, [], ['other_nodes']]) expect(() => requireDocumentSchema(3, capabilities)).toThrow('正文格式已升级')
    expect(() => requireDocumentSchema(2, ['task_lists'])).toThrow('正文格式已升级')
    expect(() => requireDocumentSchema(3, ['task_lists'])).toThrow('正文格式已升级')
    expect(() => requireDocumentSchema(3, ['task_lists', 'details'])).not.toThrow()
    expect(() => requireDocumentSchema(3, ['task_lists', 'details', 'future_nodes'])).not.toThrow()
  })
  for (const fail of [false, true]) it(`达到最大合并窗口时，${fail ? '失败清理' : '成功确认'}也先释放文档锁`, async () => {
    const id = `req_store_gate_${fail}`
    const snapshot = { title: '连续输入', contentJson: { type: 'doc' as const, content: [] } }
    const document = createCollaborationDocument(snapshot)
    const stored = vi.fn()
    const disconnect = vi.fn(async () => {
      // Hocuspocus 达到 maxDebounce 后会等待 onStoreDocument；它重新进入同一把锁。
      await exclusiveDocument(id, async () => { stored() })
    })
    vi.spyOn(Hocuspocus.prototype, 'openDirectConnection').mockResolvedValue({
      transact: async (work: (doc: Y.Doc) => void) => work(document), disconnect,
    } as Awaited<ReturnType<Hocuspocus['openDirectConnection']>>)
    const transaction = vi.fn(async () => {
      if (fail) throw new Error('写入失败')
      return { record: { ...snapshot, state: Y.encodeStateAsUpdate(document), attribution: {}, attributionSequence: 1, updatedAt: new Date() }, update: new Uint8Array([0, 0]) }
    })
    try {
      const result = acceptCollaborationEdits({ transaction } as unknown as Database, id, 'project_main', { id: 'user', name: '成员' }, [])
      if (fail) await expect(result).rejects.toThrow('写入失败')
      else await expect(result).resolves.toMatchObject({ accepted: [], sequence: 1 })
      expect(disconnect).toHaveBeenCalledWith({ unloadImmediately: false })
      expect(stored).toHaveBeenCalledOnce()
      await expect(exclusiveDocument(id, async () => '后续编辑可继续')).resolves.toBe('后续编辑可继续')
    } finally { document.destroy() }
  }, 1000)
})
