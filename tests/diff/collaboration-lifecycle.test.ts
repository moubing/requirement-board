// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { webcrypto } from 'node:crypto'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequirementCollaboration } from '../../app/composables/use-requirement-collaboration'
import { DraftStorage, type LocalDraft } from '../../app/utils/draft-storage'
import { collaborationSignature, createCollaborationDocument, decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '../../shared/collaboration/document'
import * as Y from 'yjs'
import type { DraftWrite } from '../../shared/drafts/document'
import { emptyAttribution } from '../../shared/collaboration/attribution'
import * as collaborationDocument from '../../shared/collaboration/document'

interface ProviderOptions {
  document: Y.Doc
  awareness: { destroy: () => void }
  onStateless: (message: { payload: string }) => void
}
const { providers } = vi.hoisted(() => ({ providers: [] as { destroy: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; options: ProviderOptions }[] }))
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    destroy = vi.fn(() => this.options.awareness.destroy())
    connect = vi.fn(async () => {})
    disconnect = vi.fn()
    setAwarenessField = vi.fn()
    constructor(public options: ProviderOptions) { providers.push(this) }
  },
}))

let wrapper: VueWrapper | undefined
const initial = { title: '正式版本标题', contentJson: { type: 'doc' as const, content: [
  { type: 'paragraph', attrs: { diffId: 'paragraph_original' } },
] } }

beforeEach(() => {
  vi.stubGlobal('onBeforeRouteLeave', vi.fn())
  vi.stubGlobal('onBeforeRouteUpdate', vi.fn())
  vi.stubGlobal('useRouter', () => ({ afterEach: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) }))
  vi.stubGlobal('crypto', webcrypto)
  providers.length = 0
  vi.spyOn(DraftStorage, 'open').mockResolvedValue({
    close: vi.fn(), list: vi.fn(async () => ({ drafts: [], unreadable: 0 })),
    save: vi.fn(async () => {}), remove: vi.fn(async () => {}), pruneFiles: vi.fn(async () => {}),
  } as unknown as DraftStorage)
})

afterEach(async () => {
  wrapper?.unmount(); wrapper = undefined
  await flushPromises()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function cloud() {
  const snapshot = { ...initial, title: '尚未生成正式版本的共同标题' }
  const doc = createCollaborationDocument(snapshot)
  try {
    return { state: encodeCollaborationState(doc), editEpoch: 0, agentLock: null, initialized: false,
      signature: await collaborationSignature(snapshot), updatedAt: new Date().toISOString() }
  } finally { doc.destroy() }
}

function setup(active = ref(true)) {
  let draft!: ReturnType<typeof useRequirementCollaboration>
  const title = ref(initial.title)
  wrapper = mount(defineComponent({ setup() {
    draft = useRequirementCollaboration({ requirementId: 'req_one', userId: 'user_one', title, active,
      content: ref(structuredClone(initial.contentJson)), changeNote: ref(''), baseRevisionId: ref('rev_original'),
      user: { id: 'user_one', name: '用户', color: '#123456' }, onRevision: vi.fn() })
    return () => h('div')
  } }))
  return { draft, title }
}

function appendBody(doc: Y.Doc, value: string) {
  const paragraph = doc.getXmlFragment('default').get(0) as Y.XmlElement
  const text = new Y.XmlText()
  text.insert(0, value)
  paragraph.insert(paragraph.length, [text])
}

describe('共同文档连接与保存状态', () => {
  it('确认变化保留检查点但复用 Yjs 编码，真正的正文更新才使编码失效', async () => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] }))
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    const encode = vi.spyOn(collaborationDocument, 'encodeCollaborationState')
    await draft.persistLocal(true)
    await draft.persistLocal(true)
    expect(encode).toHaveBeenCalledTimes(1)
    providers[0]!.options.onStateless({ payload: JSON.stringify({ type: 'saved', sequence: 1, signature: loaded.signature, updatedAt: loaded.updatedAt }) })
    await draft.persistLocal(true)
    expect(encode).toHaveBeenCalledTimes(1)
    active.value = false
    appendBody(draft.editorOptions.value!.document, '后台仍须保留的变化')
    await draft.persistLocal(true)
    expect(encode).toHaveBeenCalledTimes(2)
    const storage = await vi.mocked(DraftStorage.open).mock.results[0]!.value
    const record = vi.mocked(storage.save).mock.calls.at(-1)![0]
    expect(record.collaborationEdits).toHaveLength(1)
    const recovered = new Y.Doc()
    try {
      Y.applyUpdate(recovered, decodeCollaborationState(record.collaborationState!))
      expect(JSON.stringify(readCollaborationDocument(recovered))).toContain('后台仍须保留的变化')
    } finally { recovered.destroy() }
  })

  it('预取完成仍保持停用，只在详情校验后激活并复用本次协作响应', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    const original = draft.editorOptions.value!.document
    active.value = false
    const remote = new Y.Doc()
    Y.applyUpdate(remote, decodeCollaborationState(loaded.state))
    appendBody(remote, '预取的远端输入')
    loaded.state = encodeCollaborationState(remote)
    remote.destroy()
    draft.prepareResume(new AbortController().signal)
    await flushPromises()
    expect(draft.readOnly.value).toBe(true)
    expect(providers[0]!.connect).not.toHaveBeenCalled()
    expect(JSON.stringify(readCollaborationDocument(original))).not.toContain('预取的远端输入')
    active.value = true
    expect(draft.readOnly.value).toBe(true)
    await flushPromises()
    expect(draft.readOnly.value).toBe(false)
    expect(draft.editorOptions.value!.document).toBe(original)
    expect(JSON.stringify(readCollaborationDocument(original))).toContain('预取的远端输入')
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/collaboration'))).toHaveLength(2)
  })

  it('已完成但所属激活被取消的预取不能复用，恢复重新检查当前 AI 锁', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? { ...loaded } : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    active.value = false
    const controller = new AbortController()
    draft.prepareResume(controller.signal)
    await flushPromises()
    controller.abort()
    const lock = { snapshotId: 'snapshot_new', userId: 'other_user', expiresAt: new Date(Date.now() + 60_000).toISOString() }
    fetch.mockImplementationOnce(async () => ({ ...loaded, editEpoch: 1, agentLock: lock }))
    active.value = true
    await flushPromises()
    expect(draft.readOnly.value).toBe(true)
    expect(draft.agentLock.value).toEqual(lock)
    expect(draft.editEpoch.value).toBe(1)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/collaboration'))).toHaveLength(3)
  })

  it('并行预取失败后保持只读，可重试重新读取协作状态', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    active.value = false
    fetch.mockRejectedValueOnce(new Error('预取连接失败'))
    draft.prepareResume(new AbortController().signal)
    await flushPromises()
    active.value = true
    await flushPromises()
    expect(draft.readOnly.value).toBe(true)
    expect(draft.cloudError.value).toContain('预取连接失败')
    expect(providers[0]!.connect).not.toHaveBeenCalled()
    await draft.retry()
    expect(draft.readOnly.value).toBe(false)
    expect(providers[0]!.connect).toHaveBeenCalledOnce()
  })

  it('消费预取期间再次停用，迟到响应不能合并正文或重连', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    active.value = false
    let reply!: (value: typeof loaded) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
    draft.prepareResume(new AbortController().signal)
    active.value = true
    active.value = false
    const remote = new Y.Doc()
    Y.applyUpdate(remote, decodeCollaborationState(loaded.state))
    appendBody(remote, '取消后的迟到内容')
    reply({ ...loaded, state: encodeCollaborationState(remote) })
    remote.destroy()
    await flushPromises()
    expect(draft.readOnly.value).toBe(true)
    expect(providers[0]!.connect).not.toHaveBeenCalled()
    expect(JSON.stringify(readCollaborationDocument(draft.editorOptions.value!.document))).not.toContain('取消后的迟到内容')
  })

  it('停用断开感知与连接，返回核对最新正文并保留原 Y.Doc', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    const original = draft.editorOptions.value!.document
    active.value = false
    expect(providers[0]!.disconnect).toHaveBeenCalledOnce()
    expect(draft.readOnly.value).toBe(true)
    const remote = new Y.Doc()
    Y.applyUpdate(remote, decodeCollaborationState(loaded.state))
    appendBody(remote, '页面离开期间的远端编辑')
    loaded.state = encodeCollaborationState(remote)
    remote.destroy()
    active.value = true
    expect(draft.readOnly.value).toBe(true)
    await flushPromises()
    expect(draft.readOnly.value).toBe(false)
    expect(draft.editorOptions.value!.document).toBe(original)
    expect(JSON.stringify(readCollaborationDocument(original))).toContain('页面离开期间的远端编辑')
    expect(providers[0]!.connect).toHaveBeenCalledOnce()
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/collaboration'))).toHaveLength(2)
  })

  it.each([false, true])('停用期间代次变化保留未确认队列，不把旧输入补交到新代次（预取：%s）', async prepared => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    appendBody(draft.editorOptions.value!.document, '离页前未确认的输入')
    active.value = false
    await flushPromises()
    loaded.editEpoch = 1
    if (prepared) draft.prepareResume(new AbortController().signal)
    active.value = true
    await flushPromises()
    expect(draft.epochConflict.value).toBe(true)
    expect(draft.readOnly.value).toBe(true)
    expect(draft.pendingEdits.value).toBe(1)
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/edits'))).toBe(false)
    expect(JSON.stringify(readCollaborationDocument(draft.editorOptions.value!.document))).toContain('离页前未确认的输入')
  })

  it('快速再次离页丢弃迟到的重新激活响应，不重连隐藏文档', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const active = ref(true)
    const { draft } = setup(active)
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    active.value = false
    let reply!: (value: typeof loaded) => void
    fetch.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
    active.value = true
    active.value = false
    reply(loaded)
    await flushPromises()
    expect(providers[0]!.connect).not.toHaveBeenCalled()
    expect(draft.readOnly.value).toBe(true)
  })

  it('同一 Yjs 历史的离线编辑继续按原事件同步', async () => {
    const loaded = await cloud()
    const local = new Y.Doc()
    Y.applyUpdate(local, decodeCollaborationState(loaded.state))
    const vector = Y.encodeStateVector(local)
    appendBody(local, '离线正文补充')
    const state = encodeCollaborationState(local)
    const update = Buffer.from(Y.encodeStateAsUpdate(local, vector)).toString('base64')
    const snapshot = readCollaborationDocument(local)
    const edit = { id: 'edit_offline_original', clientId: local.clientID, intent: 'edit' as const, update }
    local.destroy()
    const stored: LocalDraft = { id: 'draft_offline_original', userId: 'user_one', requirementId: 'req_one', formatVersion: 1,
      snapshot: { ...snapshot, baseRevisionId: 'rev_original', changeNote: '', pendingUploads: [] },
      serverVersion: 0, syncedFingerprint: '', updatedAt: new Date().toISOString(),
      collaborationState: state, collaborationEpoch: loaded.editEpoch, collaborationEdits: [edit] }
    vi.mocked(DraftStorage.open).mockResolvedValue({ close: vi.fn(), list: vi.fn(async () => ({ drafts: [stored], unreadable: 0 })),
      files: vi.fn(async () => []), save: vi.fn(), remove: vi.fn(), pruneFiles: vi.fn() } as unknown as DraftStorage)
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/collaboration')) return loaded
      if (url.endsWith('/edits')) return { accepted: [edit.id], update: state, sequence: 1,
        snapshot: emptyAttribution(), signature: await collaborationSignature(snapshot), updatedAt: loaded.updatedAt }
      return { drafts: [], closedIds: [] }
    })
    vi.stubGlobal('$fetch', fetch)
    const { draft, title } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    await draft.flushEdits()
    expect(draft.readOnly.value).toBe(false)
    expect(draft.pendingEdits.value).toBe(0)
    expect(title.value).toBe(initial.title)
    expect(readCollaborationDocument(draft.editorOptions.value!.document)).toEqual(snapshot)
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/edits'))).toHaveLength(1)
  })

  it.each([false, true])('不同 Yjs 历史的本机副本保留待核对，不重复合并或提交（已重复：%s）', async alreadyMerged => {
    const loaded = await cloud()
    const local = createCollaborationDocument(structuredClone(initial))
    if (alreadyMerged) Y.applyUpdate(local, decodeCollaborationState(loaded.state))
    const state = encodeCollaborationState(local)
    const snapshot = readCollaborationDocument(local)
    const originalEdit = { id: 'edit_original_recovery', clientId: local.clientID, intent: 'legacy' as const, update: state }
    local.destroy()
    const stored: LocalDraft = { id: 'draft_original_recovery', userId: 'user_one', requirementId: 'req_one', formatVersion: 1,
      snapshot: { ...snapshot, baseRevisionId: 'rev_original', changeNote: '保留原说明', pendingUploads: [] },
      serverVersion: 0, syncedFingerprint: '', updatedAt: new Date().toISOString(),
      collaborationState: state, collaborationEpoch: loaded.editEpoch, collaborationEdits: [originalEdit] }
    const save = vi.fn(async () => {})
    vi.mocked(DraftStorage.open).mockResolvedValue({ close: vi.fn(), list: vi.fn(async () => ({ drafts: [stored], unreadable: 0 })),
      files: vi.fn(async () => []), save, remove: vi.fn(), pruneFiles: vi.fn() } as unknown as DraftStorage)
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const { draft } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))

    expect(draft.readOnly.value).toBe(true)
    expect(draft.epochConflict.value).toBe(true)
    expect(draft.cloudError.value).toContain('协作历史冲突')
    expect(draft.canRetry.value).toBe(false)
    expect(readCollaborationDocument(draft.editorOptions.value!.document)).toEqual(snapshot)
    expect(draft.collaborationUpdate()).toBe(state)
    expect(readCollaborationDocument(providers[0]!.options.document).title).toBe('尚未生成正式版本的共同标题')
    await expect(draft.flushEdits()).rejects.toThrow('协作历史冲突')
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/edits'))).toBe(false)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ collaborationState: state, collaborationEdits: [originalEdit] }), [])
  })

  it.each([
    { error: { statusCode: 400, data: { message: '协作内容格式无效，请检查正文或标题长度' } }, message: '协作内容格式无效，请检查正文或标题长度' },
    { error: new Error('Failed to fetch'), message: '联网后重试' },
  ])('同步失败展示对应原因：$message', async ({ error, message }) => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/edits')) throw error
      return url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] }
    }))
    const { draft, title } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    appendBody(draft.editorOptions.value!.document, '待同步的新正文')
    await expect(draft.flushEdits()).rejects.toBe(error)
    expect(draft.cloudError.value).toContain(message)
    if (message !== '联网后重试') expect(draft.cloudError.value).not.toContain('联网后重试')
    expect(draft.pendingEdits.value).toBe(1)
  })

  it('AI 读取锁定后只读，采纳直接跟随当前草稿并恢复编辑，无需导出刷新', async () => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] }))
    const { draft, title } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    const provider = providers[0]!.options
    const receive = (payload: unknown) => provider.onStateless({ payload: JSON.stringify(payload) })
    receive({ type: 'agent-lock', editEpoch: 1, lock: { snapshotId: 'snap_test', userId: 'user_one', userName: '用户',
      acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), suggestionId: null } })
    expect(draft.readOnly.value).toBe(true)
    expect(draft.canReleaseLock.value).toBe(true)
    expect(draft.epochConflict.value).toBe(false)
    expect(draft.status.value).toBe('AI 正在编辑 · 只读')
    await expect(draft.prepareVersion()).rejects.toThrow('只能查看')
    receive({ type: 'epoch', editEpoch: 2 })
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(provider.document))
    remote.getText('title').delete(0, remote.getText('title').length)
    remote.getText('title').insert(0, 'AI 采纳后的当前草稿')
    Y.applyUpdate(provider.document, Y.encodeStateAsUpdate(remote))
    remote.destroy()
    receive({ type: 'agent-lock', editEpoch: 2, lock: null })
    expect(title.value).toBe(initial.title)
    expect(readCollaborationDocument(draft.editorOptions.value!.document).title).toBe('AI 采纳后的当前草稿')
    expect(draft.epochConflict.value).toBe(false)
    expect(draft.readOnly.value).toBe(false)
    expect(draft.editEpoch.value).toBe(2)
    receive({ type: 'agent-lock', editEpoch: 1, lock: { userId: 'old' } })
    expect(draft.readOnly.value).toBe(false)
  })

  it('锁定前有未确认输入时保留本机内容，不把旧修改写回 AI 草稿', async () => {
    const loaded = await cloud()
    const fetch = vi.fn(async (url: string) => url.endsWith('/collaboration') ? loaded : { drafts: [], closedIds: [] })
    vi.stubGlobal('$fetch', fetch)
    const { draft, title } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    appendBody(draft.editorOptions.value!.document, '锁定前未上传的正文')
    const provider = providers[0]!.options
    provider.onStateless({ payload: JSON.stringify({ type: 'agent-lock', editEpoch: 1, lock: { snapshotId: 'snap_test',
      userId: 'another', userName: '同事', acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), suggestionId: null } }) })
    expect(draft.epochConflict.value).toBe(true)
    expect(draft.canRetry.value).toBe(false)
    expect(draft.pendingEdits.value).toBeGreaterThan(0)
    expect(draft.canReleaseLock.value).toBe(false)
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(provider.document))
    remote.getText('title').insert(0, 'AI：')
    Y.applyUpdate(provider.document, Y.encodeStateAsUpdate(remote)); remote.destroy()
    expect(readCollaborationDocument(draft.editorOptions.value!.document).contentJson.content[0]!.content?.[0]?.text).toBe('锁定前未上传的正文')
    await flushPromises()
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/edits'))).toBe(false)
  })

  it('较早的 HTTP 确认迟到时，不覆盖已收到的较新保存状态', async () => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/collaboration')
      ? loaded : { drafts: [], closedIds: [] }))
    const { draft } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    const receive = providers[0]!.options.onStateless
    receive({ payload: JSON.stringify({ type: 'saved', sequence: 12, signature: 'new', updatedAt: '2026-09-06T12:00:02.000Z' }) })
    receive({ payload: JSON.stringify({ type: 'saved', sequence: 11, signature: 'old', updatedAt: '2026-09-06T12:00:01.000Z' }) })
    expect(draft.cloudTime.value).toBe('2026-09-06T12:00:02.000Z')
  })
  it('新打开未发布的共同内容时，显示草稿已保存，不误报正式版本', async () => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/collaboration')
      ? loaded : { drafts: [], closedIds: [] }))
    const { draft, title } = setup()
    await vi.waitFor(() => expect(draft.ready.value).toBe(true))
    expect(title.value).toBe(initial.title)
    expect(draft.status.value).toBe('草稿已同步')
    title.value = '属性接口保存后的标题'
    await draft.flushEdits()
    expect(draft.pendingEdits.value).toBe(0)
    expect(readCollaborationDocument(draft.editorOptions.value!.document).title).toBe('尚未生成正式版本的共同标题')
  })

  it('首次协作请求失败后仍可重试并完成初始化', async () => {
    const loaded = await cloud()
    const initialize = vi.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(loaded)
    vi.stubGlobal('$fetch', vi.fn(async (url: string, options?: { method?: string; body?: DraftWrite }) => {
      if (url.endsWith('/collaboration')) return initialize()
      if (options?.method === 'PUT') return { ...options.body!.snapshot, id: url.split('/').at(-1),
        version: 1, updatedAt: new Date().toISOString(), closedAt: null }
      return { drafts: [], closedIds: [] }
    }))
    const { draft } = setup()
    await vi.waitFor(() => expect(draft.recoveryError.value).toContain('协作连接失败'))
    expect(draft.ready.value).toBe(false)
    expect(draft.canRetry.value).toBe(true)

    await draft.retry()

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(draft.ready.value).toBe(true)
    expect(draft.recoveryError.value).toBe('')
    expect(providers).toHaveLength(1)
  })

  it('等待保存签名时离开页面，不再建立后台协作连接', async () => {
    const loaded = await cloud()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => url.endsWith('/collaboration')
      ? loaded : { drafts: [], closedIds: [] }))
    let resolveDigest!: (value: ArrayBuffer) => void
    const digest = vi.fn(() => new Promise<ArrayBuffer>(resolve => { resolveDigest = resolve }))
    vi.stubGlobal('crypto', { subtle: { digest } })
    setup()
    await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce())
    wrapper!.unmount(); wrapper = undefined
    resolveDigest(new ArrayBuffer(32))
    await flushPromises()
    expect(providers).toHaveLength(0)
  })
})
