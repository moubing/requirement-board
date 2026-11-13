// @vitest-environment happy-dom
import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useRequirementAnnotations } from '../../app/composables/use-requirement-annotations'
import { anchorSegment, annotationFingerprint, extractAnnotationBlocks, parseAnnotationRequest, captureObjectTarget, captureNodeTarget, type AnnotationCompletion } from '../../shared/agent/annotations'
import type { RichTextDocument } from '../../shared/editor/document'

const apps: App[] = []
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); vi.restoreAllMocks() })
function setup(fetchCompletions?: (annotations: AnnotationCompletion[], signal: AbortSignal) => Promise<{ completed: AnnotationCompletion[] }>) {
  const content = ref<RichTextDocument>({ type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [{ type: 'text', text: '原文' }] }] })
  const userId = ref('user-a'), requirementId = ref('req_first')
  const active = ref(true)
  const flush = vi.fn(async () => {}), connected = ref(true), pending = ref(false)
  const editingId = ref(''), onCompleted = vi.fn(), acknowledgeCompletions = vi.fn(async (_annotations: AnnotationCompletion[]) => {})
  let store!: ReturnType<typeof useRequirementAnnotations>
  const app = createApp({ setup() {
    store = useRequirementAnnotations({ userId, requirementId, content, active, key: ref('REQ-1'), title: ref('需求'), flush,
      canCopy: () => connected.value, hasPendingEdits: () => pending.value, fetchCompletions, acknowledgeCompletions, editingId, onCompleted })
    return () => h('div')
  } })
  app.mount(document.createElement('div')); apps.push(app)
  const note = { id: 'one', quote: '原文', comment: '补充规则', section: '', segments: [anchorSegment(extractAnnotationBlocks(content.value)[0]!, 0, 2)] }
  return { store, note, userId, requirementId, active, flush, connected, pending, content, editingId, onCompleted, acknowledgeCompletions }
}

it('缓存停用后暂停回执，重新激活保留未成功落盘的标注', async () => {
  const fetch = vi.fn(async () => ({ completed: [] }))
  const { store, note, active } = setup(fetch)
  const getItem = localStorage.getItem.bind(localStorage)
  vi.stubGlobal('localStorage', { getItem, setItem: () => { throw new Error('quota') } })
  store.upsert(note)
  active.value = false; await nextTick()
  await store.refreshCompletions()
  expect(fetch).not.toHaveBeenCalled()
  active.value = true; await nextTick()
  expect(store.notes.value).toEqual([note])
  expect(store.storageError.value).toContain('暂未保存')
})

it('旧 v2 对象加载、重新复制及与新节点混用不转换旧目标，原回执仍可清理', async () => {
  let completed: AnnotationCompletion[] = []
  const { store, content, active } = setup(async () => ({ completed }))
  content.value = { type: 'doc', content: [
    { type: 'image', attrs: { diffId: 'old-image', src: '/uploads/legacy.png' }, content: [{ type: 'imageCaption' }] },
    { type: 'callout', attrs: { diffId: 'new-callout', tone: 'note' }, content: [{ type: 'text', text: '提示内容' }] },
  ] }
  const old = { id: 'old', target: captureObjectTarget(content.value, 'image', 'old-image'), quote: '旧图片', comment: '改题注', section: '', segments: [] }
  const next = { id: 'new', target: captureNodeTarget(content.value, 'new-callout'), quote: '提示内容', comment: '改为警告', section: '', segments: [] }
  const fingerprint = await annotationFingerprint(old, '')
  store.upsert(old); store.upsert(next)
  active.value = false; await nextTick(); active.value = true; await nextTick()
  expect(store.notes.value).toEqual([old, next])
  await store.exportRequest(false); store.previewCopied()
  expect(parseAnnotationRequest(store.preview.value).annotations).toEqual([old, next])
  expect(store.notes.value[0]).toEqual(old)
  completed = [{ id: old.id, fingerprint }]
  await store.refreshCompletions()
  expect(store.notes.value).toEqual([next])
})

it('正文先到先显示核对中，超时恢复真实失效原因；重试仍按复制前的旧摘要清理', async () => {
  vi.useFakeTimers()
  const fetchCompletions = vi.fn(() => new Promise<{ completed: AnnotationCompletion[] }>(() => {}))
  const { store, note, content } = setup(fetchCompletions)
  const oldFingerprint = await annotationFingerprint(note, '')
  store.upsert(note)
  content.value = { type: 'doc', content: [{ type: 'paragraph', attrs: { diffId: 'p1' }, content: [{ type: 'text', text: 'AI 已替换正文' }] }] }
  const pending = store.refreshCompletions()
  await vi.waitFor(() => expect(fetchCompletions).toHaveBeenCalledOnce())
  expect(store.resolutions.value[0]!.reason).toContain('正在核对')
  await vi.advanceTimersByTimeAsync(15_000)
  await pending
  expect(store.resolutions.value[0]!.reason).toContain('已变化')
  expect(store.completionError.value).toContain('核对')
  expect(store.notes.value).toEqual([note])
  fetchCompletions.mockResolvedValue({ completed: [{ id: note.id, fingerprint: oldFingerprint }] })
  await store.refreshCompletions()
  expect(store.notes.value).toHaveLength(0)
  expect(content.value.content[0]!.content![0]!.text).toBe('AI 已替换正文')
})

it('成功回执清除对应标注；新要求、新标注和正在编辑的内容保留，关闭重开可补查', async () => {
  let completed: AnnotationCompletion[] = []
  const fetchCompletions = vi.fn(async () => ({ completed }))
  const { store, note, content, editingId, onCompleted, acknowledgeCompletions } = setup(fetchCompletions)
  store.upsert(note); store.upsert({ ...note, id: 'two' })
  await store.exportRequest(false)
  expect(store.notes.value[0]).not.toHaveProperty('target')
  store.previewCopied()
  const exported = parseAnnotationRequest(store.preview.value)
  completed = exported.completion!
  expect(completed).toHaveLength(2)
  expect(completed[0]!.fingerprint).toBe(await annotationFingerprint({ ...note, target: { type: 'text' } }, ''))
  store.upsert({ ...note, id: 'two', comment: '复制后新增的要求' })
  store.upsert({ ...note, id: 'three' })
  editingId.value = note.id
  await store.refreshCompletions()
  expect(store.notes.value).toHaveLength(3)
  expect(acknowledgeCompletions).not.toHaveBeenCalled()
  editingId.value = ''
  acknowledgeCompletions.mockImplementation(async () => {
    expect(JSON.parse(localStorage.getItem('rb-ai-annotations:v1:user-a:req_first')!).notes.map((item: { id: string }) => item.id)).toEqual(['two', 'three'])
  })
  await store.refreshCompletions()
  expect(store.notes.value.map(item => item.id)).toEqual(['two', 'three'])
  expect(onCompleted).toHaveBeenCalledWith(1)
  expect(acknowledgeCompletions).toHaveBeenCalledExactlyOnceWith([completed[0]])
  expect(content.value.content[0]!.content![0]!.text).toBe('原文')
  completed = [{ id: 'three', fingerprint: await annotationFingerprint(store.notes.value[1]!, '') }]
  apps.splice(0).forEach(app => app.unmount())
  const restored = setup(fetchCompletions)
  await restored.store.refreshCompletions()
  expect(restored.store.notes.value.map(item => item.id)).toEqual(['two'])
  expect(restored.acknowledgeCompletions).toHaveBeenCalledExactlyOnceWith(completed)
})

it('清理结果写入本机失败时不移除或确认；确认网络失败不恢复已落盘的旧标注', async () => {
  const completed: AnnotationCompletion[] = []
  const { store, note, acknowledgeCompletions, onCompleted } = setup(async () => ({ completed }))
  store.upsert(note)
  completed.push({ id: note.id, fingerprint: await annotationFingerprint(note, '') })
  const key = 'rb-ai-annotations:v1:user-a:req_first'
  vi.stubGlobal('localStorage', { getItem: localStorage.getItem.bind(localStorage), setItem: () => { throw new Error('quota') } })
  await store.refreshCompletions()
  expect(store.notes.value).toEqual([note])
  expect(JSON.parse(localStorage.getItem(key)!).notes).toEqual([note])
  expect(store.completionError.value).toContain('清理结果')
  expect(acknowledgeCompletions).not.toHaveBeenCalled()
  expect(onCompleted).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  acknowledgeCompletions.mockRejectedValue(new Error('offline'))
  await store.refreshCompletions()
  expect(store.notes.value).toEqual([])
  expect(JSON.parse(localStorage.getItem(key)!).notes).toEqual([])
  expect(acknowledgeCompletions).toHaveBeenCalledExactlyOnceWith(completed)
  expect(store.completionError.value).toBe('')
  apps.splice(0).forEach(app => app.unmount())
  expect(setup().store.notes.value).toEqual([])
})

it('旧回执、网络失败和查询期间的身份/要求变化均不清除标注', async () => {
  let finish!: (value: { completed: AnnotationCompletion[] }) => void
  const fetchCompletions = vi.fn(() => new Promise<{ completed: AnnotationCompletion[] }>(resolve => { finish = resolve }))
  const { store, note, userId } = setup(fetchCompletions)
  store.upsert(note)
  const completed = [{ id: note.id, fingerprint: await annotationFingerprint(note, '') }]
  const pending = store.refreshCompletions()
  await vi.waitFor(() => expect(fetchCompletions).toHaveBeenCalled())
  store.overall.value = '新整体要求'
  finish({ completed }); await pending
  expect(store.notes.value).toHaveLength(1)
  fetchCompletions.mockResolvedValue({ completed })
  await store.refreshCompletions()
  expect(store.notes.value).toHaveLength(1)
  fetchCompletions.mockRejectedValue(new Error('offline'))
  await store.refreshCompletions()
  expect(store.completionError.value).toContain('标注已保留')
  expect(store.notes.value).toHaveLength(1)
  fetchCompletions.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const switched = store.refreshCompletions()
  await vi.waitFor(() => expect(fetchCompletions).toHaveBeenCalledTimes(4))
  userId.value = 'user-b'; store.upsert(note)
  finish({ completed }); await switched
  expect(store.notes.value).toHaveLength(1)
})

it('回执查询前后先同步其他标签页的新要求，不用旧状态覆盖本机数据', async () => {
  let finish!: (value: { completed: AnnotationCompletion[] }) => void
  const fetchCompletions = vi.fn(() => new Promise<{ completed: AnnotationCompletion[] }>(resolve => { finish = resolve }))
  const { store, note } = setup(fetchCompletions)
  const key = 'rb-ai-annotations:v1:user-a:req_first'
  store.upsert(note)
  const revised = { ...note, comment: '另一个标签页修改的要求' }
  localStorage.setItem(key, JSON.stringify({ version: 1, notes: [revised], overall: '' }))
  await store.refreshCompletions()
  expect(fetchCompletions).not.toHaveBeenCalled()
  expect(store.notes.value).toEqual([revised])
  const pending = store.refreshCompletions()
  await vi.waitFor(() => expect(fetchCompletions).toHaveBeenCalledOnce())
  const latest = { ...revised, comment: '查询期间再次修改' }
  localStorage.setItem(key, JSON.stringify({ version: 1, notes: [latest], overall: '' }))
  finish({ completed: [{ id: revised.id, fingerprint: await annotationFingerprint(revised, '') }] })
  await pending
  expect(store.notes.value).toEqual([latest])
  expect(JSON.parse(localStorage.getItem(key)!).notes).toEqual([latest])
  localStorage.removeItem(key)
  await store.refreshCompletions()
  expect(store.notes.value).toEqual([])
  expect(localStorage.getItem(key)).toBeNull()
})

it('按账号和文档隔离本机标注，切换不把旧数据写入新账号，正文保持不变', () => {
  const { store, note, userId, requirementId, content } = setup()
  const original = JSON.stringify(content.value)
  store.upsert(note); store.overall.value = '整体要求'
  userId.value = 'user-b'
  expect(store.notes.value).toEqual([])
  expect(store.overall.value).toBe('')
  store.upsert({ ...note, comment: '另一个用户' })
  requirementId.value = 'req_second'
  expect(store.notes.value).toEqual([])
  userId.value = 'user-a'; requirementId.value = 'req_first'
  expect(store.notes.value[0]?.comment).toBe('补充规则')
  expect(store.overall.value).toBe('整体要求')
  expect(JSON.stringify(content.value)).toBe(original)
  const restored = setup()
  expect(restored.store.notes.value).toEqual([note])
  store.remove('one')
  expect(store.notes.value).toHaveLength(0)
  expect(store.activeId.value).toBe('')
})

it('存储受限时保留内存标注并报告失败，损坏数据不会导致页面崩溃', () => {
  localStorage.setItem('rb-ai-annotations:v1:user-a:req_first', 'invalid json')
  const { store, note } = setup()
  expect(store.storageError.value).toContain('未能读取')
  // Happy DOM 会绑定 Storage 实例方法，替换全局引用以保证模拟失败可完整恢复。
  vi.stubGlobal('localStorage', { getItem: localStorage.getItem.bind(localStorage), setItem: () => { throw new Error('quota') } })
  store.upsert(note)
  expect(store.notes.value).toHaveLength(1)
  expect(store.storageError.value).toContain('暂未保存')
})

it('清除全部只清除当前账号和文档的标注，保留正文与整体要求并持久化结果', () => {
  const { store, note, userId, requirementId, content } = setup()
  const original = JSON.stringify(content.value)
  store.upsert(note); store.upsert({ ...note, id: 'two' }); store.overall.value = '整体要求'
  userId.value = 'user-b'
  store.upsert({ ...note, comment: '另一账号的标注' })
  userId.value = 'user-a'; requirementId.value = 'req_second'
  store.upsert({ ...note, comment: '另一文档的标注' })
  requirementId.value = 'req_first'
  store.activeId.value = 'two'
  store.preview.value = '旧预览'; store.copied.value = true; store.error.value = '旧错误'
  store.clear()
  expect(store.notes.value).toEqual([])
  expect(store.activeId.value).toBe('')
  expect(store.preview.value).toBe('')
  expect(store.copied.value).toBe(false)
  expect(store.error.value).toBe('')
  expect(store.overall.value).toBe('整体要求')
  expect(JSON.stringify(content.value)).toBe(original)
  const restored = setup().store
  expect(restored.notes.value).toEqual([])
  expect(restored.overall.value).toBe('整体要求')
  userId.value = 'user-b'
  expect(store.notes.value[0]?.comment).toBe('另一账号的标注')
  userId.value = 'user-a'; requirementId.value = 'req_second'
  expect(store.notes.value[0]?.comment).toBe('另一文档的标注')
})

it('离线、未同步、同步拒绝时不生成可发送请求，也不会丢失标注', async () => {
  const { store, note, connected, flush, pending } = setup()
  store.upsert(note)
  connected.value = false
  await store.exportRequest(false)
  expect(flush).not.toHaveBeenCalled()
  expect(store.error.value).toContain('连接恢复')
  connected.value = true; pending.value = true
  await store.exportRequest(false)
  expect(flush).toHaveBeenCalledOnce()
  expect(store.error.value).toContain('尚未同步')
  pending.value = false; flush.mockRejectedValue(new Error('同步失败'))
  await store.exportRequest(false)
  expect(store.error.value).toBe('同步失败')
  expect(store.preview.value).toBe('')
  expect(store.notes.value).toHaveLength(1)
  expect(store.busy.value).toBe(false)
})
