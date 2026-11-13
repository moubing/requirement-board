import { describe, expect, it } from 'vitest'

import type { RichTextDocument } from '../../shared/editor/document'
import type { SelectionHistoryAnchor } from '../../shared/diff/selection-history'
import {
  readSelectionHistoryTabContext,
  selectionHistoryContextStorageKey,
  type SelectionHistoryTabContext,
  writeSelectionHistoryTabContext,
} from '../../app/components/diff/selection-history-tab-context'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const document: RichTextDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [{ type: 'text', text: 'hello' }] }],
}

const anchor: SelectionHistoryAnchor = {
  text: 'hello',
  scope: 'selection',
  segments: [{ blockId: 'p1', blockType: 'paragraph', start: 0, end: 5, text: 'hello' }],
}

const context: SelectionHistoryTabContext = {
  requirementId: 'req-1',
  anchor,
  draftDocument: document,
  currentUserName: '当前用户',
  capturedAt: '2026-08-23T08:00:00.000Z',
}

describe('selection history tab context', () => {
  it('从跨标签页存储消费上下文，并复制到当前标签页以支持刷新', () => {
    const sharedStorage = new MemoryStorage()
    const tabStorage = new MemoryStorage()

    writeSelectionHistoryTabContext(sharedStorage, 'token-1', context, { now: 1000 })

    expect(readSelectionHistoryTabContext(
      sharedStorage,
      tabStorage,
      'token-1',
      'req-1',
      { now: 2000 },
    )).toEqual({ ok: true, context })
    expect(sharedStorage.getItem(selectionHistoryContextStorageKey('token-1'))).toBeNull()
    expect(tabStorage.getItem(selectionHistoryContextStorageKey('token-1'))).not.toBeNull()

    expect(readSelectionHistoryTabContext(
      sharedStorage,
      tabStorage,
      'token-1',
      'req-1',
      { now: 3000 },
    )).toEqual({ ok: true, context })
  })

  it('拒绝已过期的上下文并清理存储', () => {
    const sharedStorage = new MemoryStorage()
    const tabStorage = new MemoryStorage()

    writeSelectionHistoryTabContext(sharedStorage, 'expired', context, { now: 1000, ttlMs: 100 })

    expect(readSelectionHistoryTabContext(
      sharedStorage,
      tabStorage,
      'expired',
      'req-1',
      { now: 1100 },
    )).toEqual({ ok: false, reason: 'expired' })
    expect(sharedStorage.length).toBe(0)
    expect(tabStorage.length).toBe(0)
  })

  it('拒绝属于其他需求或已损坏的上下文', () => {
    const sharedStorage = new MemoryStorage()
    const tabStorage = new MemoryStorage()

    writeSelectionHistoryTabContext(sharedStorage, 'wrong-requirement', context, { now: 1000 })
    expect(readSelectionHistoryTabContext(
      sharedStorage,
      tabStorage,
      'wrong-requirement',
      'req-2',
      { now: 2000 },
    )).toEqual({ ok: false, reason: 'requirement-mismatch' })

    sharedStorage.setItem(selectionHistoryContextStorageKey('broken'), '{broken')
    expect(readSelectionHistoryTabContext(
      sharedStorage,
      tabStorage,
      'broken',
      'req-1',
      { now: 2000 },
    )).toEqual({ ok: false, reason: 'invalid' })
  })

  it('写入新上下文时顺带清理遗留的过期项', () => {
    const storage = new MemoryStorage()
    writeSelectionHistoryTabContext(storage, 'old', context, { now: 1000, ttlMs: 100 })
    writeSelectionHistoryTabContext(storage, 'new', context, { now: 1200 })

    expect(storage.getItem(selectionHistoryContextStorageKey('old'))).toBeNull()
    expect(storage.getItem(selectionHistoryContextStorageKey('new'))).not.toBeNull()
  })

  it('保存节点名单并拒绝损坏的作者数据', () => {
    const storage = new MemoryStorage()
    const attribution = { version: 2 as const, baseRevisionId: 'v1', baseVersion: 1, nodes: [{ id: 'p1', type: 'paragraph', unknown: false, authors: [{ userId: 'a', name: '甲' }] }] }
    writeSelectionHistoryTabContext(storage, 'valid', { ...context, attribution }, { now: 1000 })
    expect(readSelectionHistoryTabContext(storage, new MemoryStorage(), 'valid', 'req-1', { now: 2000 }).ok).toBe(true)
    for (const authors of [[{ userId: null }], 'broken', null]) {
      writeSelectionHistoryTabContext(storage, 'broken-source', { ...context,
        attribution: { ...attribution, nodes: [{ ...attribution.nodes[0]!, authors }] } } as unknown as SelectionHistoryTabContext, { now: 1000 })
      expect(readSelectionHistoryTabContext(storage, new MemoryStorage(), 'broken-source', 'req-1', { now: 2000 }))
        .toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('旧标签页保留选区上下文，但不把逐字作者冒充为本版修改人', () => {
    const storage = new MemoryStorage()
    writeSelectionHistoryTabContext(storage, 'old-source', { ...context, attribution: { version: 1, blocks: [] } } as unknown as SelectionHistoryTabContext, { now: 1000 })
    expect(readSelectionHistoryTabContext(storage, new MemoryStorage(), 'old-source', 'req-1', { now: 2000 }))
      .toEqual({ ok: true, context: { ...context, attribution: null } })
  })
})
