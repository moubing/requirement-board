import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftStorage, type LocalDraft } from '../../app/utils/draft-storage'
import { DraftSyncQueue } from '../../app/utils/draft-sync'
import { cloneDraftSnapshot, draftFingerprint, type DraftSnapshot, type StoredDraft } from '../../shared/drafts/document'

function snapshot(text = '草稿正文'): DraftSnapshot {
  return { baseRevisionId: 'rev_base', title: '标题', contentJson: { type: 'doc', content: [
    { type: 'paragraph', attrs: { diffId: 'paragraph_1' }, content: [{ type: 'text', text }] },
  ] }, changeNote: '说明', pendingUploads: [] }
}
const upload = { id: 'upload_restore_1', imageDiffId: 'img_restored', fileName: '图片.png', mimeType: 'image/png', size: 3, position: 1, order: 1 }
function record(id = 'draft_one', userId = 'user_one'): LocalDraft {
  return { id, userId, requirementId: 'req_one', formatVersion: 1, snapshot: snapshot(), serverVersion: 0,
    syncedFingerprint: '', updatedAt: new Date().toISOString() }
}
function reply(body: DraftSnapshot, version: number): StoredDraft {
  return { ...cloneDraftSnapshot(body), id: 'draft_one', userId: 'user_one', requirementId: 'req_one', version,
    lastMutationId: null, updatedAt: new Date().toISOString(), closedAt: null }
}
afterEach(() => vi.unstubAllGlobals())

describe('本地草稿和图片恢复', () => {
  it('重新打开数据库后恢复完整正文、图片文件和位置，隔离用户与文档', async () => {
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    const factory = new IDBFactory()
    const store = await DraftStorage.open(factory)
    const local = record()
    local.collaborationState = 'AAA='
    local.collaborationEdits = [{ id: 'edit_original_offline_event_01', clientId: 1, update: 'AAA=', intent: 'edit' }]
    local.snapshot.pendingUploads = [upload]
    await store.save(local, [{ ...upload, file: new Blob(['png'], { type: 'image/png' }) }])
    await store.save(record('draft_other', 'user_other'), [])
    store.close()
    const reopened = await DraftStorage.open(factory)
    expect((await reopened.list('user_one', 'req_one')).drafts).toEqual([local])
    expect((await reopened.list('user_one', 'req_other')).drafts).toEqual([])
    const files = await reopened.files(local.id, local.userId)
    expect(await files[0]!.file.text()).toBe('png')
    expect(await reopened.files(local.id, 'user_other')).toEqual([])
    await reopened.remove(local.id, 'user_other')
    expect((await reopened.list(local.userId, local.requirementId)).drafts).toHaveLength(1)
    reopened.close()
  })

  it('正文更新不会重写原图片；确认同步后才按任务清理，丢弃只清理对应草稿', async () => {
    vi.stubGlobal('IDBKeyRange', IDBKeyRange)
    const store = await DraftStorage.open(new IDBFactory())
    const local = record()
    await store.save(local, [{ ...upload, file: new Blob(['png']) }])
    local.snapshot = snapshot('继续编辑')
    await store.save(local, [{ ...upload, file: new Blob(['不同的文件']) }])
    expect(await (await store.files(local.id, local.userId))[0]!.file.text()).toBe('png')
    await store.pruneFiles(local.id, local.userId, [upload.id])
    expect(await store.files(local.id, local.userId)).toHaveLength(1)
    await store.pruneFiles(local.id, local.userId, [])
    expect(await store.files(local.id, local.userId)).toEqual([])
    await store.save(record('draft_two'), [{ ...upload, file: new Blob(['png']) }])
    await store.remove(local.id, local.userId)
    expect((await store.list(local.userId, local.requirementId)).drafts.map(row => row.id)).toEqual(['draft_two'])
    expect(await store.files('draft_two', local.userId)).toHaveLength(1)
    store.close()
  })

  it('损坏或未来格式的记录不会被误恢复或自动删除', async () => {
    const factory = new IDBFactory()
    const store = await DraftStorage.open(factory)
    await store.save({ ...record(), formatVersion: 99 } as unknown as LocalDraft, [])
    expect(await store.list('user_one', 'req_one')).toEqual({ drafts: [], unreadable: 1 })
    expect(await store.list('user_one', 'req_one')).toEqual({ drafts: [], unreadable: 1 })
    store.close()
  })

  it('业务校验尚未通过的标题和说明也能在本地恢复', async () => {
    const store = await DraftStorage.open(new IDBFactory())
    const local = record()
    local.snapshot.title = '长'.repeat(300)
    local.snapshot.changeNote = '说明'.repeat(300)
    await store.save(local, [])
    expect((await store.list(local.userId, local.requirementId)).drafts[0]!.snapshot).toEqual(local.snapshot)
    store.close()
  })

  it('旧备份含空地址图片时保留原件与事件，只恢复可读的新备份', async () => {
    const factory = new IDBFactory()
    const store = await DraftStorage.open(factory)
    const old = record('draft_old_invalid')
    old.snapshot.contentJson.content.push({ type: 'image', attrs: { src: null, align: 'center', diffId: 'broken_image' },
      content: [{ type: 'imageCaption' }] })
    old.collaborationEdits = [{ id: 'edit_original_offline_event_01', clientId: 1, update: 'AAA=', intent: 'edit' }]
    const current = record('draft_current_valid')
    await store.save(old, [])
    await store.save(current, [])
    expect(await store.list('user_one', 'req_one')).toEqual({ drafts: [current], unreadable: 1 })
    store.close()
    const opened = factory.open('requirement-board-drafts', 1)
    const db = await new Promise<IDBDatabase>(resolve => { opened.onsuccess = () => resolve(opened.result) })
    const request = db.transaction('drafts').objectStore('drafts').get(old.id)
    const retained = await new Promise(resolve => { request.onsuccess = () => resolve(request.result) })
    expect(retained).toEqual(old)
    db.close()
  })
})

describe('草稿同步队列', () => {
  it('明确校验失败后可提交修正内容，不反复重试无效快照', async () => {
    const send = vi.fn().mockRejectedValueOnce({ statusCode: 400 })
      .mockImplementation(async write => reply(write.snapshot, (write.expectedVersion ?? 0) + 1))
    const queue = new DraftSyncQueue(send)
    await expect(queue.sync({ ...snapshot(), title: '长'.repeat(300) })).rejects.toMatchObject({ statusCode: 400 })
    await queue.sync(snapshot('修正后正文'))
    expect(send.mock.calls).toHaveLength(2)
    expect(send.mock.calls[1]![0].expectedVersion).toBe(0)
    expect(send.mock.calls[1]![0].snapshot).toEqual(snapshot('修正后正文'))
    expect(queue.version).toBe(1)
  })

  it('失败后复用相同请求 ID 和内容，确认后再提交后续编辑', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('response lost'))
      .mockImplementation(async write => reply(write.snapshot, (write.expectedVersion ?? 0) + 1))
    const queue = new DraftSyncQueue(send)
    await expect(queue.sync(snapshot('第一次'))).rejects.toThrow('response lost')
    expect(queue.version).toBe(0)
    await queue.sync(snapshot('第二次'))
    expect(send.mock.calls).toHaveLength(3)
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0])
    expect(send.mock.calls[2]![0].expectedVersion).toBe(1)
    expect(queue.version).toBe(2)
    expect(queue.syncedFingerprint).toBe(draftFingerprint(snapshot('第二次')))
  })

  it('请求串行执行，不重复提交相同内容，旧响应不把新编辑标记为已同步', async () => {
    let finish!: (value: StoredDraft) => void
    const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockImplementation(async write => reply(write.snapshot, (write.expectedVersion ?? 0) + 1))
    const queue = new DraftSyncQueue(send)
    const first = queue.sync(snapshot('旧内容'))
    const second = queue.sync(snapshot('新内容'))
    expect(send).toHaveBeenCalledTimes(1)
    finish(reply(snapshot('旧内容'), 1))
    await first
    await second
    expect(send).toHaveBeenCalledTimes(2)
    expect(queue.syncedFingerprint).toBe(draftFingerprint(snapshot('新内容')))
    await queue.sync(snapshot('新内容'))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('JSON 对象键顺序不影响内容身份，块 ID 与数组顺序仍参与比较', () => {
    const original = snapshot()
    const reordered = JSON.parse(JSON.stringify(original), (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value)
    expect(draftFingerprint(original)).toBe(draftFingerprint(reordered))
    reordered.contentJson.content[0].attrs.diffId = 'different'
    expect(draftFingerprint(original)).not.toBe(draftFingerprint(reordered))
  })
})
