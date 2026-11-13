// @vitest-environment happy-dom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequirementDraft } from '../../app/composables/use-requirement-draft'
import { DraftStorage, type LocalDraft } from '../../app/utils/draft-storage'
import { cloneDraftSnapshot, draftFingerprint, type DraftSnapshot, type DraftWrite, type StoredDraft } from '../../shared/drafts/document'

const snapshot = (title = '原始标题'): DraftSnapshot => ({ baseRevisionId: 'rev_original', title, changeNote: '', pendingUploads: [],
  contentJson: { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'paragraph_original' } }] } })
let wrapper: VueWrapper | undefined
let records: Map<string, LocalDraft>
let storage: DraftStorage
let remote: { drafts: StoredDraft[]; closedIds: string[] }
let send: ReturnType<typeof vi.fn>
let afterNavigation: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-06T08:00:00Z'))
  vi.stubGlobal('onBeforeRouteLeave', vi.fn())
  vi.stubGlobal('onBeforeRouteUpdate', vi.fn())
  afterNavigation = vi.fn(() => () => {})
  vi.stubGlobal('useRouter', () => ({ afterEach: afterNavigation, onError: vi.fn(() => () => {}) }))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  records = new Map()
  remote = { drafts: [], closedIds: [] }
  storage = { close: vi.fn(), list: vi.fn(async () => ({ drafts: [...records.values()], unreadable: 0 })),
    save: vi.fn(async (record: LocalDraft) => { records.set(record.id, structuredClone(record)) }),
    remove: vi.fn(async (id: string) => { records.delete(id) }), files: vi.fn(async () => []), pruneFiles: vi.fn(async () => {}) } as unknown as DraftStorage
  vi.spyOn(DraftStorage, 'open').mockResolvedValue(storage)
  send = vi.fn(async (url: string, options?: { method?: string; body?: DraftWrite }) => {
    if (options?.method !== 'PUT') return remote
    const write = options.body!
    return { ...cloneDraftSnapshot(write.snapshot), id: url.split('/').at(-1), userId: 'user_one', requirementId: 'req_one',
      version: (write.expectedVersion ?? 0) + 1, lastMutationId: write.mutationId, updatedAt: new Date().toISOString(), closedAt: null }
  })
  vi.stubGlobal('$fetch', send)
})

afterEach(async () => {
  wrapper?.unmount(); wrapper = undefined
  await flushPromises()
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function setup(collaboration?: Parameters<typeof useRequirementDraft>[0]['collaboration'], saving = ref(false), active = ref(true)) {
  const initial = snapshot()
  const title = ref(initial.title)
  const content = shallowRef(initial.contentJson), changeNote = ref('')
  let draft!: ReturnType<typeof useRequirementDraft>
  wrapper = mount(defineComponent({ setup() {
    draft = useRequirementDraft({ requirementId: 'req_one', userId: 'user_one', title,
      content, changeNote, baseRevisionId: ref(initial.baseRevisionId), collaboration, saving, active })
    return () => h('div')
  } }))
  await flushPromises()
  expect(draft.ready.value).toBe(true)
  return { draft, title, content, changeNote }
}
const writes = () => send.mock.calls.filter(([, options]) => options?.method === 'PUT')

describe('草稿页面生命周期', () => {
  it('输入同步路径不访问正文内容，空闲后核对撤销回基线', async () => {
    const { draft, content } = await setup()
    const initial = content.value
    const read = vi.fn(() => [{ type: 'paragraph', attrs: { diffId: 'paragraph_original' }, content: [{ type: 'text', text: '输入' }] }])
    content.value = { type: 'doc', get content() { return read() } }
    expect(draft.hasChanges.value).toBe(true)
    expect(draft.needsBackup.value).toBe(true)
    expect(read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(read).toHaveBeenCalled()
    content.value = initial
    expect(draft.hasChanges.value).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(draft.hasChanges.value).toBe(false)
    expect(draft.needsBackup.value).toBe(false)
  })

  it('相同检查点的并发备份和再次离页只写一次；队列确认与 epoch 变化仍重新写入', async () => {
    let generation = 0, epoch = 1
    const state = vi.fn(() => '完整 Yjs 状态')
    const { draft, title } = await setup({ state, generation: () => generation, epoch: () => epoch, initialize: async () => {} })
    title.value = '最新内容'
    let release!: () => void
    vi.mocked(storage.save).mockImplementationOnce(async record => {
      await new Promise<void>(resolve => { release = resolve })
      records.set(record.id, structuredClone(record))
    })
    const first = draft.persistLocal(), second = draft.persistLocal()
    await flushPromises()
    expect(storage.save).toHaveBeenCalledTimes(1)
    release()
    expect(await first).toBe(true); expect(await second).toBe(true)
    expect(await draft.prepareLeave()).toBe('local')
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(state).toHaveBeenCalledTimes(1)
    generation++
    expect(await draft.prepareLeave()).toBe('local')
    expect(storage.save).toHaveBeenCalledTimes(2)
    epoch++
    expect(await draft.prepareLeave()).toBe('local')
    expect(records.get(draft.id.value)!.collaborationEpoch).toBe(2)
    expect(storage.save).toHaveBeenCalledTimes(3)
  })

  it('停用后释放导航锁与周期同步，仍保留本地检查点；返回可再次导航', async () => {
    const active = ref(true)
    const { draft, title } = await setup(undefined, ref(false), active)
    title.value = '离页之前最后输入'
    const leave = vi.mocked(onBeforeRouteLeave).mock.calls[0]![0]!
    expect(await leave({ fullPath: '/templates' })).toBe(true)
    expect(draft.navigationPending.value).toBe(true)
    active.value = false
    expect(draft.navigationPending.value).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes()).toHaveLength(0)
    expect(records.get(draft.id.value)?.snapshot.title).toBe('离页之前最后输入')
    active.value = true
    expect(await leave({ fullPath: '/members' })).toBe(true)
  })

  it('同路由参数切换等待本地事务，保留最后输入，且不等待服务器', async () => {
    const { draft, title } = await setup()
    title.value = '最后一个字'
    let release!: () => void
    vi.mocked(storage.save).mockImplementationOnce(async record => {
      await new Promise<void>(resolve => { release = resolve })
      records.set(record.id, structuredClone(record))
    })
    const update = vi.mocked(onBeforeRouteUpdate).mock.calls[0]![0]!
    const leaving = update({ fullPath: '/requirements/req_two', params: { id: 'req_two' } }, { params: { id: 'req_one' } })
    await flushPromises()
    expect(draft.navigationPending.value).toBe(true)
    expect(records.size).toBe(0)
    release(); expect(await leaving).toBe(true)
    expect(records.get(draft.id.value)?.snapshot.title).toBe('最后一个字')
    expect(writes()).toHaveLength(0)
    expect(draft.navigationPending.value).toBe(true)
  })

  it('本地备份失败可由已确认的服务器副本放行，双重失败则保留当前页', async () => {
    const { draft, title } = await setup()
    title.value = '仍要恢复的内容'
    vi.mocked(storage.save).mockRejectedValue(new Error('QuotaExceededError'))
    expect(await draft.prepareLeave()).toBe('server')
    title.value = '最新内容'
    send.mockRejectedValue(new Error('offline'))
    expect(await draft.prepareLeave()).toBe('blocked')
    expect(draft.navigationError.value).toContain('完整备份')
  })

  it('事务期间又收到修改时补写最新状态，不把旧快照当作完成', async () => {
    const { draft, title } = await setup()
    title.value = '事务开始前'
    vi.mocked(storage.save).mockImplementationOnce(async record => {
      records.set(record.id, structuredClone(record)); title.value = '事务期间收到的编辑'
    })
    expect(await draft.prepareLeave()).toBe('local')
    expect(records.get(draft.id.value)?.snapshot.title).toBe('事务期间收到的编辑')
  })

  it('离开时保存原编辑事件和图片 Blob，重开沿用事件身份', async () => {
    const edits = [{ id: 'edit_original', clientId: 42, update: 'AQID', intent: 'edit' as const }]
    const initialize = vi.fn(async () => {})
    const { draft } = await setup({ state: () => 'state_complete', epoch: () => 3, edits: () => edits, initialize })
    const file = new Blob(['png'], { type: 'image/png' })
    const upload = { id: 'upload_pending', imageDiffId: 'img_pending', fileName: '图片.png', mimeType: 'image/png', size: 3, position: 1, order: 1, file }
    draft.setUploads([upload])
    expect(await draft.prepareLeave()).toBe('local')
    expect(storage.save).toHaveBeenLastCalledWith(expect.objectContaining({ collaborationState: 'state_complete', collaborationEdits: edits }), [upload])
    const savedId = draft.id.value
    vi.mocked(storage.files).mockResolvedValue([{ key: `${savedId}:${upload.id}`, draftId: savedId, userId: 'user_one', uploadId: upload.id, file }])
    wrapper!.unmount(); wrapper = undefined
    await flushPromises()
    const reopened = await setup({ state: () => 'state_complete', edits: () => edits, initialize })
    expect(initialize).toHaveBeenLastCalledWith('state_complete', true, edits, 3)
    expect(reopened.draft.uploads.value[0]?.file).toBe(file)
    expect(writes()).toHaveLength(0)
  })

  it('冲突归档保留完整副本，重开时不把归档或对应服务器草稿再次自动恢复', async () => {
    const { draft, title } = await setup({ state: () => 'old-state', epoch: () => 0, initialize: async () => {} })
    title.value = '离线尚未同步的内容'
    await draft.sync(true)
    const saved = await draft.sync(true)
    if (saved) remote.drafts = [saved]
    await draft.archiveRecovery()
    const oldId = draft.id.value
    wrapper!.unmount(); wrapper = undefined
    await flushPromises()
    expect(records.get(oldId)).toMatchObject({ recoveryOnly: true, collaborationState: 'old-state', snapshot: { title: '离线尚未同步的内容' } })
    const reopened = await setup()
    expect(reopened.title.value).toBe('原始标题')
    expect(records.get(oldId)!.snapshot.title).toBe('离线尚未同步的内容')
  })

  it('本地不可写时，未上传图片或未确认事件均阻止切换', async () => {
    const flush = vi.fn(async () => {})
    const edits = [{ id: 'edit_unconfirmed', clientId: 42, update: 'AQID', intent: 'edit' as const }]
    const { draft, title } = await setup({ state: () => 'state', edits: () => edits, flush, initialize: async () => {} })
    title.value = '未确认的编辑'
    vi.mocked(storage.save).mockRejectedValue(new Error('QuotaExceededError'))
    expect(await draft.prepareLeave()).toBe('blocked')
    expect(flush).toHaveBeenCalledOnce()
    expect(writes()).toHaveLength(0)
    edits.length = 0
    draft.setUploads([{ id: 'upload_pending', imageDiffId: 'img_pending', fileName: '图片.png', mimeType: 'image/png', size: 3, position: 1, order: 1, file: new Blob(['png']) }])
    expect(await draft.prepareLeave()).toBe('blocked')
    expect(flush).toHaveBeenCalledOnce()
    expect(writes()).toHaveLength(0)
  })

  it('正式保存锁定切换，重复导航不会解锁正在备份的页面，取消后允许重试', async () => {
    const saving = ref(true)
    const { draft, title } = await setup(undefined, saving)
    const update = vi.mocked(onBeforeRouteUpdate).mock.calls[0]![0]!
    const from = { params: { id: 'req_one' } }
    const target = { fullPath: '/requirements/req_two', params: { id: 'req_two' } }
    const another = { fullPath: '/requirements/req_three', params: { id: 'req_three' } }
    expect(await update(target, from)).toBe(false)
    saving.value = false
    title.value = '切换前最后输入'
    let release!: () => void
    vi.mocked(storage.save).mockImplementationOnce(async record => {
      await new Promise<void>(resolve => { release = resolve })
      records.set(record.id, structuredClone(record))
    })
    const first = update(target, from)
    await flushPromises()
    expect(await update(another, from)).toBe(false)
    const afterEach = afterNavigation.mock.calls[0]![0]
    afterEach(another, from, new Error('aborted'))
    expect(draft.navigationPending.value).toBe(true)
    release(); expect(await first).toBe(true)
    afterEach(target, from, new Error('cancelled'))
    expect(draft.navigationPending.value).toBe(false)
    expect(await update(target, from)).toBe(true)
    expect(writes()).toHaveLength(0)
  })

  it('协作正文不周期发送完整 JSON，保存期间收到的修改不被旧快照覆盖', async () => {
    const { draft, title, content, changeNote } = await setup({ state: () => 'encoded-yjs-state', initialize: async () => {} })
    title.value = '准备保存的标题'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(writes()).toHaveLength(0)
    expect(records.get(draft.id.value)?.collaborationState).toBe('encoded-yjs-state')
    changeNote.value = '原版本说明'
    const prepared = await draft.prepareVersion()
    const editorKey = draft.editorKey.value
    title.value = '提交期间收到的新标题'
    content.value = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'remote-edit' }, content: [{ type: 'text', text: '等待保存时收到的新正文' }] }] }
    changeNote.value = '重试期间写入的新说明'
    await draft.versionSaved(prepared.draftId, { ...prepared.snapshot, baseRevisionId: 'rev_published' }, prepared.snapshot.changeNote)
    expect(title.value).toBe('提交期间收到的新标题')
    expect(changeNote.value).toBe('重试期间写入的新说明')
    expect(records.get(draft.id.value)?.snapshot.contentJson).toEqual(content.value)
    expect(draft.editorKey.value).toBe(editorKey)
    expect(records.get(draft.id.value)?.snapshot.title).toBe(title.value)
    expect(draft.hasChanges.value).toBe(true)
  })

  it('保存期间有新修改且接续备份失败时，保留旧的本地副本', async () => {
    const { draft, title } = await setup({ state: () => 'encoded-yjs-state', initialize: async () => {} })
    title.value = '准备保存的标题'
    const prepared = await draft.prepareVersion()
    title.value = '保存期间收到的新标题'
    await draft.persistLocal()
    vi.mocked(storage.save).mockRejectedValue(new Error('QuotaExceededError'))

    await draft.versionSaved(prepared.draftId, { ...prepared.snapshot, baseRevisionId: 'rev_published' })

    expect(draft.hasChanges.value).toBe(true)
    expect(draft.needsBackup.value).toBe(true)
    expect(draft.localError.value).toContain('本地保存不可用')
    expect(records.get(prepared.draftId)?.snapshot.title).toBe(title.value)
    expect(storage.remove).not.toHaveBeenCalledWith(prepared.draftId, 'user_one')
  })

  it('先完成本地备份，30 秒同步一次；没有新修改时不重复发送', async () => {
    const { draft, title } = await setup()
    title.value = '尚未发布的标题'
    await vi.advanceTimersByTimeAsync(500)
    expect(draft.needsBackup.value).toBe(false)
    expect(records.get(draft.id.value)?.snapshot.title).toBe(title.value)
    await vi.advanceTimersByTimeAsync(28_500)
    expect(writes()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(writes()).toHaveLength(1)
    expect(draft.status.value).toBe('草稿已同步')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(writes()).toHaveLength(1)
  })

  it('正式保存后不会因重建编辑器的空上传事件产生幽灵草稿', async () => {
    const { draft, title } = await setup()
    title.value = '新标题'
    const prepared = await draft.prepareVersion()
    await draft.versionSaved(prepared.draftId, { ...prepared.snapshot, baseRevisionId: 'rev_published' })
    draft.setUploads([])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(records.size).toBe(0)
    expect(draft.hasChanges.value).toBe(false)
    expect(draft.status.value).toBe('当前内容已保存为版本')
    expect(writes()).toHaveLength(1)
  })

  it('服务器草稿已结束时，只清理已同步副本，保留响应丢失后继续编辑的内容', async () => {
    const published = snapshot('已提交内容')
    const local = (id: string, current: DraftSnapshot): LocalDraft => ({ id, userId: 'user_one', requirementId: 'req_one', formatVersion: 1,
      snapshot: current, serverVersion: 1, syncedFingerprint: draftFingerprint(published), updatedAt: new Date().toISOString() })
    records.set('draft_closed_clean', local('draft_closed_clean', published))
    records.set('draft_closed_dirty', local('draft_closed_dirty', snapshot('提交之后继续编辑')))
    remote.closedIds = [...records.keys()]
    const { draft, title } = await setup()
    expect(records.has('draft_closed_clean')).toBe(false)
    expect(title.value).toBe('提交之后继续编辑')
    expect(draft.id.value).not.toBe('draft_closed_dirty')
    expect(records.get(draft.id.value)?.snapshot.title).toBe(title.value)
    expect(records.has('draft_closed_dirty')).toBe(false)
  })

  it('本地写入失败后不能误报备份成功，并在 5 秒内尝试服务器同步', async () => {
    vi.mocked(storage.save).mockRejectedValue(new Error('QuotaExceededError'))
    const { draft, title } = await setup()
    title.value = '本地磁盘不足时的输入'
    await vi.advanceTimersByTimeAsync(500)
    expect(draft.needsBackup.value).toBe(true)
    expect(draft.localError.value).toContain('本地保存不可用')
    await vi.advanceTimersByTimeAsync(4500)
    expect(writes()).toHaveLength(1)
    expect(draft.needsBackup.value).toBe(false)
    expect(draft.status.value).toBe('草稿已同步')
  })

  it('重新打开自动恢复完整内容与未上传图片，继续更新同一份草稿', async () => {
    const previous = snapshot('尚未保存的标题')
    previous.changeNote = '未提交的说明'
    previous.pendingUploads = [{ id: 'upload_pending_image', imageDiffId: 'img_pending', fileName: '图片.png', mimeType: 'image/png', size: 3, position: 1, order: 1 }]
    const original: LocalDraft = { id: 'draft_resume_existing', userId: 'user_one', requirementId: 'req_one', formatVersion: 1,
      snapshot: previous, serverVersion: 0, syncedFingerprint: '', updatedAt: new Date().toISOString() }
    records.set(original.id, original)
    const file = new Blob(['png'], { type: 'image/png' })
    vi.mocked(storage.files).mockResolvedValue([{ key: `${original.id}:upload_pending_image`, draftId: original.id, userId: 'user_one', uploadId: 'upload_pending_image', file }])
    const first = await setup()
    expect(first.draft.id.value).toBe(original.id)
    expect(first.draft.snapshot()).toEqual(previous)
    expect(first.draft.uploads.value[0]!.file).toBe(file)
    first.title.value = '继续编辑后的标题'
    await first.draft.persistLocal()
    wrapper!.unmount(); wrapper = undefined
    await flushPromises()
    const reopened = await setup()
    expect(reopened.title.value).toBe('继续编辑后的标题')
    expect(reopened.draft.id.value).toBe(original.id)
    expect(records.size).toBe(1)
    await reopened.draft.sync()
    expect(writes()[0]![0]).toContain(original.id)
    expect(writes()[0]![1]!.body!.expectedVersion).toBe(0)
  })

  it('直接恢复服务器内容和更新编号，未修改时不重复同步', async () => {
    const current: StoredDraft = { ...snapshot('另一设备上的编辑'), id: 'draft_cloud_resume', userId: 'user_one', requirementId: 'req_one',
      version: 7, lastMutationId: 'mutation_previous', updatedAt: new Date().toISOString(), closedAt: null }
    remote.drafts = [current]
    const { draft, title } = await setup()
    expect(title.value).toBe(current.title)
    expect(draft.id.value).toBe(current.id)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(writes()).toHaveLength(0)
    expect((await draft.prepareVersion()).draftId).toBe(current.id)
    expect(writes()).toHaveLength(0)
    title.value = '接着编辑'
    await draft.sync()
    expect(writes()[0]![1]!.body!.expectedVersion).toBe(7)
  })

  it('联网重试不会覆盖已经开始输入的内容，同步成功后清除临时读取错误', async () => {
    send.mockRejectedValueOnce(new Error('offline'))
    const { draft, title } = await setup()
    expect(draft.recoveryError.value).toContain('暂时无法读取服务器')
    title.value = '读取失败后继续输入的内容'
    await draft.retry()
    expect(title.value).toBe('读取失败后继续输入的内容')
    expect(writes()[0]![1]!.body!.snapshot.title).toBe(title.value)
    expect(draft.recoveryError.value).toBe('')
  })

  it('服务器记录更新后，本机未同步内容仍可自动保存', async () => {
    const acknowledged = snapshot('上次同步的内容')
    const local = snapshot('本机尚未同步的内容')
    const original: LocalDraft = { id: 'draft_unsynced', userId: 'user_one', requirementId: 'req_one', formatVersion: 1,
      snapshot: local, serverVersion: 1, syncedFingerprint: draftFingerprint(acknowledged), updatedAt: new Date().toISOString() }
    records.set(original.id, original)
    remote.drafts = [{ ...snapshot('另一页面的内容'), id: original.id, userId: 'user_one', requirementId: 'req_one',
      version: 2, lastMutationId: 'mutation_elsewhere', updatedAt: new Date().toISOString(), closedAt: null }]
    const { draft, title } = await setup()
    expect(title.value).toBe(local.title)
    expect(draft.cloudError.value).toBe('')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(writes()).toHaveLength(1)
    expect(writes()[0]![1]!.body!.expectedVersion).toBe(2)
    expect(writes()[0]![1]!.body!.snapshot.title).toBe(local.title)
    expect(draft.id.value).toBe(original.id)
    expect(draft.status.value).toBe('草稿已同步')
  })

  it('草稿已结束时自动接续保存后续输入，无需人工确认', async () => {
    const { draft, title } = await setup()
    title.value = '保存版本之后继续输入的内容'
    await draft.persistLocal()
    const previousId = draft.id.value
    send.mockRejectedValueOnce({ statusCode: 410 })
    await draft.sync()
    expect(draft.id.value).not.toBe(previousId)
    expect(title.value).toBe('保存版本之后继续输入的内容')
    expect(writes()).toHaveLength(2)
    expect(writes()[1]![0]).toContain(draft.id.value)
    expect(writes()[1]![1]!.body!.snapshot.title).toBe(title.value)
    expect(records.has(previousId)).toBe(false)
    expect(records.get(draft.id.value)?.snapshot.title).toBe(title.value)
    expect(draft.cloudError.value).toBe('')
    expect(draft.status.value).toBe('草稿已同步')
  })
})
