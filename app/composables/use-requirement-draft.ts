import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch, type Ref } from 'vue'
import { nanoid } from 'nanoid'
import { cloneDraftSnapshot, draftError, draftFingerprint, type DraftSnapshot, type LocalImageUpload, type StoredDraft } from '#shared/drafts/document'
import type { RichTextDocument } from '#shared/editor/document'
import { DraftStorage, type LocalDraft } from '../utils/draft-storage'
import { DraftSyncQueue } from '../utils/draft-sync'
import type { CollaborationEdit } from '#shared/collaboration/attribution'

const serverRestoreFailure = '暂时无法读取服务器上的未保存内容，正在使用本机记录；联网后可重试。'

interface SavedDraft {
  id: string
  snapshot: DraftSnapshot
  updatedAt: string
  local?: LocalDraft
  server?: StoredDraft
  closed?: boolean
  serverAvailable: boolean
}

interface Options {
  requirementId: string
  userId: string
  title: Ref<string>
  content: Ref<RichTextDocument>
  changeNote: Ref<string>
  baseRevisionId: Ref<string>
  saving?: Ref<boolean>
  active?: Ref<boolean>
  collaboration?: {
    state: () => string | undefined
    epoch?: () => number
    edits?: () => CollaborationEdit[]
    generation?: () => number
    flush?: () => Promise<void>
    initialize: (state: string | undefined, recovered: boolean, edits?: CollaborationEdit[], epoch?: number) => Promise<{ preserveLegacy?: boolean } | void>
  }
}

export function useRequirementDraft(options: Options) {
  const ready = ref(false)
  const id = ref(`draft_${nanoid(24)}`)
  const uploads = shallowRef<LocalImageUpload[]>([])
  const editorKey = ref(0)
  const localError = ref('')
  const cloudError = ref('')
  const recoveryError = ref('')
  const syncing = ref(false)
  const busy = ref(false)
  const navigationPending = ref(false)
  const navigationError = ref('')
  const localFingerprint = ref('')
  const cloudFingerprint = ref('')
  const localTime = ref('')
  const cloudTime = ref('')
  const baseline = ref('')
  let storage: DraftStorage | undefined
  let disposed = false
  let suspended = false
  let localTimer: ReturnType<typeof setTimeout> | undefined
  let localDeadline: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let localWrite: Promise<void> = Promise.resolve()
  let firstChangeAt = ''
  let lastAttempt = 0
  let failures = 0
  let syncCalls = 0
  let recoveredState: string | undefined
  let recoveredEdits: CollaborationEdit[] | undefined
  let recoveredEpoch: number | undefined
  let recoveryOnly = false
  let preparationFailed = false
  let personalFingerprint = JSON.stringify({ changeNote: '', pendingUploads: [] })
  let queue = createQueue(id.value)
  let generation = 0
  let localSignature = ''
  let pendingBackup: { signature: string; promise: Promise<boolean> } | undefined
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  const checking = ref(false)
  const checkedFingerprint = ref('')

  function createQueue(draftId: string, initial?: ConstructorParameters<typeof DraftSyncQueue>[1]) {
    return new DraftSyncQueue(write => $fetch<StoredDraft>(`/api/requirements/${options.requirementId}/drafts/${draftId}`, {
      method: 'PUT', body: write, timeout: 10_000, retry: 0,
    }), initial)
  }

  // 正文快照以整个对象替换；同一代次共用不可变快照，异步写入持有自己的旧对象。
  const capturedSnapshot = computed(() => cloneDraftSnapshot({ baseRevisionId: options.baseRevisionId.value, title: options.title.value,
    contentJson: toRaw(options.content.value), changeNote: options.changeNote.value, pendingUploads: uploads.value }))
  function snapshot(): DraftSnapshot { return capturedSnapshot.value }
  const fingerprint = computed(() => draftFingerprint(snapshot()))
  function reconcile() {
    clearTimeout(checkTimer); checkTimer = undefined
    checkedFingerprint.value = fingerprint.value
    checking.value = false
    return checkedFingerprint.value
  }
  const hasChanges = computed(() => ready.value && (checking.value || checkedFingerprint.value !== baseline.value))
  const needsBackup = computed(() => ready.value && (checking.value || (hasChanges.value && checkedFingerprint.value !== localFingerprint.value && checkedFingerprint.value !== cloudFingerprint.value)))
  const canRetry = computed(() => ready.value && !busy.value && !syncing.value)
  const status = computed(() => {
    if (!ready.value) return '正在检查草稿'
    if (cloudError.value) return cloudError.value
    if (checking.value) return '正在备份草稿'
    if (!hasChanges.value && !queue.version) return '当前内容已保存为版本'
    if (syncing.value) return '正在同步草稿'
    if (cloudFingerprint.value === checkedFingerprint.value) return uploads.value.length ? `正文已同步，${uploads.value.length} 张图片待上传` : '草稿已同步'
    if (localFingerprint.value === checkedFingerprint.value) return '草稿已保存到本机，等待同步'
    return '正在备份草稿'
  })

  function record(captured: DraftSnapshot): LocalDraft {
    return { id: id.value, userId: options.userId, requirementId: options.requirementId, formatVersion: 1,
      snapshot: captured, serverVersion: queue.version, syncedFingerprint: queue.syncedFingerprint,
      updatedAt: firstChangeAt || new Date().toISOString(), collaborationState: options.collaboration?.state(),
      collaborationEdits: options.collaboration?.edits?.(), collaborationEpoch: options.collaboration?.epoch?.(), recoveryOnly }
  }

  async function persistLocal(force = false) {
    clearTimeout(localTimer); clearTimeout(localDeadline)
    localTimer = localDeadline = undefined
    if (!storage || !ready.value || disposed || !options.baseRevisionId.value) return false
    reconcile()
    if (!force && !hasChanges.value && !queue.version && !firstChangeAt && !options.collaboration?.edits?.().length) return false
    const signature = backupSignature()
    if (signature === localSignature && !localError.value) return true
    if (pendingBackup?.signature === signature) return pendingBackup.promise
    const captured = snapshot()
    const capturedFingerprint = fingerprint.value
    const data = record(captured)
    const capturedUploads = [...uploads.value]
    const target = storage
    const operation = localWrite.catch(() => undefined).then(() => target.save(data, capturedUploads))
    localWrite = operation
    const attempt = { signature, promise: operation.then(() => {
      if (id.value === data.id) {
        localSignature = signature
        localFingerprint.value = capturedFingerprint
        localTime.value = new Date().toISOString()
        localError.value = ''
      }
      return true
    }).catch(() => {
      localError.value = '本地保存不可用，请保持联网，等待服务器同步完成。'
      return false
    }).finally(() => { if (pendingBackup === attempt) pendingBackup = undefined }) }
    pendingBackup = attempt
    return attempt.promise
  }

  function changed() {
    generation++
    if (!ready.value || suspended || disposed) return
    // 输入与确认回调只标记代次，不能在同步 watcher 内遍历正文或编码 Yjs。
    checking.value = true
    clearTimeout(checkTimer)
    checkTimer = setTimeout(reconcile, 200)
    firstChangeAt = new Date().toISOString()
    clearTimeout(localTimer)
    localTimer = setTimeout(() => void persistLocal(), 500)
    if (!localDeadline) localDeadline = setTimeout(() => void persistLocal(), 1500)
  }

  watch([options.title, options.content, options.changeNote, options.baseRevisionId, uploads], changed, { flush: 'sync' })

  async function sync(force = false): Promise<StoredDraft | null> {
    if (!ready.value || disposed || !options.baseRevisionId.value) return null
    reconcile()
    if (!force && !hasChanges.value && !queue.version) return null
    const captured = snapshot()
    const personal = JSON.stringify({ changeNote: captured.changeNote, pendingUploads: captured.pendingUploads })
    // 协作正文由 Yjs 增量同步；个人接口只在说明或上传任务改变时补存。
    if (options.collaboration && !force && personal === personalFingerprint) return null
    const capturedId = id.value
    const targetQueue = queue
    if (!force && draftFingerprint(captured) === queue.syncedFingerprint) return null
    syncing.value = true
    syncCalls++
    lastAttempt = Date.now()
    try {
      const saved = await targetQueue.sync(captured)
      if (id.value !== capturedId) return saved
      cloudFingerprint.value = targetQueue.syncedFingerprint
      cloudTime.value = saved.updatedAt
      cloudError.value = ''
      personalFingerprint = personal
      if (recoveryError.value === serverRestoreFailure) recoveryError.value = ''
      failures = 0
      await persistLocal()
      // 上传任务已进入服务端正文且本地没有更新后，才释放对应二进制副本。
      if (storage && fingerprint.value === targetQueue.syncedFingerprint) {
        await localWrite.catch(() => undefined)
        await storage.pruneFiles(capturedId, options.userId, uploads.value.map(upload => upload.id)).catch(() => undefined)
      }
      return saved
    } catch (error) {
      if (id.value === capturedId) {
        failures++
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 410) {
          // 保存版本已结束这份草稿，但页面仍有后续输入时，自动接续保存。
          id.value = `draft_${nanoid(24)}`
          queue = createQueue(id.value)
          localFingerprint.value = cloudFingerprint.value = localTime.value = cloudTime.value = ''
          cloudError.value = ''
          if (await persistLocal()) await storage?.remove(capturedId, options.userId).catch(() => undefined)
          return await sync(true)
        }
        cloudError.value = statusCode === 401 ? '登录已过期，草稿将继续备份到本机，请重新登录。'
          : statusCode === 403 ? '暂时无权同步，草稿保留在本机。'
          : `同步失败：${draftError(error)}`
      }
      return null
    } finally { syncCalls--; syncing.value = syncCalls > 0 }
  }

  async function ensureServerDraft() {
    // 图片任务启动时立即落本地，并为服务器上的图片创建草稿归属。
    await persistLocal()
    if (!queue.version && !await sync(true)) throw new Error(cloudError.value || '请先同步草稿再上传图片')
    return id.value
  }

  async function readSavedDraft() {
    recoveryError.value = ''
    const results = await Promise.allSettled([
      storage?.list(options.userId, options.requirementId) ?? Promise.resolve({ drafts: [] as LocalDraft[], unreadable: 0 }),
      $fetch<{ drafts: StoredDraft[]; closedIds: string[] }>(`/api/requirements/${options.requirementId}/drafts`, { timeout: 10_000, retry: 0 }),
    ])
    if (disposed) return
    const local = results[0].status === 'fulfilled' ? results[0].value.drafts : []
    if (results[0].status === 'rejected') recoveryError.value = '暂时无法读取本地草稿，原数据已保留；可先使用服务器草稿。'
    if (results[0].status === 'fulfilled' && results[0].value.unreadable) recoveryError.value = '部分本地草稿格式无法读取，原数据已保留。'
    const serverAvailable = results[1].status === 'fulfilled'
    const remote = results[1].status === 'fulfilled' ? results[1].value : { drafts: [], closedIds: [] }
    if (!serverAvailable) recoveryError.value = serverRestoreFailure
    const merged = new Map<string, SavedDraft>()
    for (const draft of remote.drafts) {
      merged.set(draft.id, { id: draft.id, snapshot: cloneDraftSnapshot(draft), updatedAt: draft.updatedAt,
        server: draft, serverAvailable })
    }
    for (const draft of local) {
      if (draft.recoveryOnly) { merged.delete(draft.id); continue }
      const unsynced = draftFingerprint(draft.snapshot) !== draft.syncedFingerprint || Boolean(draft.collaborationEdits?.length)
      // 保存成功但响应丢失后，用户可能继续编辑；墓碑不能删除这部分新内容。
      if (remote.closedIds.includes(draft.id) && !unsynced) { await storage?.remove(draft.id, options.userId); continue }
      const server = merged.get(draft.id)
      merged.set(draft.id, { id: draft.id, snapshot: unsynced || !server ? draft.snapshot : server.snapshot,
        updatedAt: unsynced || !server ? draft.updatedAt : server.updatedAt,
        local: draft, server: server?.server, closed: remote.closedIds.includes(draft.id), serverAvailable })
    }
    return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }

  function begin(captured: DraftSnapshot, recoveredUploads: LocalImageUpload[] = [], remount = true) {
    suspended = true
    id.value = `draft_${nanoid(24)}`
    queue = createQueue(id.value)
    personalFingerprint = JSON.stringify({ changeNote: '', pendingUploads: [] })
    localFingerprint.value = cloudFingerprint.value = localTime.value = cloudTime.value = ''
    cloudError.value = ''
    failures = 0
    firstChangeAt = new Date().toISOString()
    // 协作页面的标题是独立保存的属性，旧本机草稿不能覆盖服务器上的改名。
    if (!options.collaboration) options.title.value = captured.title
    options.content.value = captured.contentJson
    options.changeNote.value = captured.changeNote
    options.baseRevisionId.value = captured.baseRevisionId
    uploads.value = recoveredUploads
    reconcile()
    if (remount) editorKey.value++
    suspended = false
  }

  async function recoverSavedDraft() {
    const saved = await readSavedDraft()
    if (!saved || disposed) return
    recoveredState = saved.local?.collaborationState
    recoveredEdits = saved.local?.collaborationEdits
    recoveredEpoch = saved.local?.collaborationEpoch
    const files = storage ? await storage.files(saved.id, options.userId).catch(() => {
      recoveryError.value = '部分本地图片无法读取，正文已恢复，图片将尝试从服务器恢复。'
      return []
    }) : []
    if (disposed) return
    const recoveredUploads = saved.snapshot.pendingUploads.map(upload => ({ ...upload, file: files.find(file => file.uploadId === upload.id)?.file }))
    begin(cloneDraftSnapshot(saved.snapshot), recoveredUploads)
    firstChangeAt = saved.updatedAt
    // 已结束草稿中仍有后续输入时，用新身份保存；正常刷新继续更新原草稿。
    if (saved.closed) return saved.id
    id.value = saved.id
    const currentFingerprint = reconcile()
    const serverFingerprint = saved.server ? draftFingerprint(saved.server) : ''
    queue = createQueue(saved.id, !saved.server ? {
      version: saved.serverAvailable && !saved.server ? 0 : saved.local?.serverVersion ?? 0,
      syncedFingerprint: saved.local?.syncedFingerprint ?? '',
    } : { version: saved.server.version, syncedFingerprint: serverFingerprint, result: saved.server })
    if (saved.local && draftFingerprint(saved.local.snapshot) === currentFingerprint) {
      localFingerprint.value = currentFingerprint
      localTime.value = saved.local.updatedAt
    }
    cloudFingerprint.value = serverFingerprint
    cloudTime.value = saved.server?.updatedAt ?? ''
    if (saved.server) personalFingerprint = JSON.stringify({ changeNote: saved.server.changeNote, pendingUploads: saved.server.pendingUploads })
  }

  async function retry() {
    if (!canRetry.value) return
    busy.value = true
    try {
      if (preparationFailed) {
        await prepareCollaboration()
        preparationFailed = false
        recoveryError.value = ''
      }
      // 初次读取失败且用户尚未输入时，可以安全补做自动恢复。
      const previousId = recoveryError.value && !hasChanges.value && !queue.version ? await recoverSavedDraft() : undefined
      const saved = await persistLocal()
      if (saved && previousId) await storage?.remove(previousId, options.userId)
      if (hasChanges.value || queue.version) await sync(true)
    } catch (error) { recoveryError.value = draftError(error) }
    finally { busy.value = false }
  }

  async function prepareVersion() {
    await persistLocal()
    const captured = snapshot()
    const saved = await sync(true)
    if (!saved) throw new Error(cloudError.value || '草稿同步未完成，请重试')
    return { snapshot: captured, draftId: id.value }
  }

  async function versionSaved(capturedId: string, next: DraftSnapshot, submittedNote = options.changeNote.value) {
    await localWrite.catch(() => undefined)
    const current = options.collaboration ? { ...snapshot(), baseRevisionId: next.baseRevisionId,
      changeNote: options.changeNote.value === submittedNote ? '' : options.changeNote.value } : next
    begin(cloneDraftSnapshot(current), options.collaboration ? uploads.value : [], !options.collaboration)
    baseline.value = draftFingerprint(next)
    firstChangeAt = ''
    const hasPendingEdits = Boolean(options.collaboration?.edits?.().length)
    let canRemovePrevious = !hasChanges.value && !hasPendingEdits
    if (hasChanges.value || hasPendingEdits) {
      firstChangeAt = new Date().toISOString()
      canRemovePrevious = await persistLocal()
    }
    // 保存期间收到的新修改必须先完成备份，不能因新记录写入失败而清掉旧副本。
    if (storage && canRemovePrevious) await storage.remove(capturedId, options.userId).catch(() => undefined)
  }

  async function prepareCollaboration() {
    if (!options.collaboration) return
    const result = await options.collaboration.initialize(recoveredState, Boolean(firstChangeAt), recoveredEdits, recoveredEpoch)
    // 接入协作前的独立草稿没有 CRDT 历史；保留原记录，不能用它覆盖共同文档。
    if (result?.preserveLegacy) begin(snapshot(), uploads.value)
    if (!firstChangeAt) baseline.value = reconcile()
  }

  function setUploads(value: LocalImageUpload[]) {
    // 挂载/重建编辑器会再次报告空队列，不应把它当作新草稿。
    if (!value.length && !uploads.value.length) return
    uploads.value = value
  }

  function backupSignature() {
    // generation() 先收束原事件记录器；生产协作路径只读取计数，兼容旧调用方。
    const collaboration = options.collaboration
    const state = collaboration?.generation ? collaboration.generation() : [collaboration?.state(), collaboration?.edits?.()]
    // 确认编号递增已覆盖个人同步指纹变化，无需把整篇指纹放进代次令牌。
    return JSON.stringify([generation, state, id.value, queue.version, recoveryOnly, collaboration?.epoch?.()])
  }

  async function archiveRecovery() {
    recoveryOnly = true
    if (!await persistLocal(true)) {
      recoveryOnly = false
      throw new Error('本机副本保存失败，请保持当前页面并重试')
    }
  }

  async function prepareLeave(): Promise<'unnecessary' | 'local' | 'server' | 'blocked'> {
    navigationError.value = ''
    if (options.saving?.value || busy.value) {
      navigationError.value = '正在保存或恢复内容，请完成后再切换。'
      return 'blocked'
    }
    // 初始化期间没有开放编辑，不需要写一份尚未恢复的空快照。
    if (!ready.value) return 'unnecessary'
    reconcile()
    const pending = options.collaboration?.edits?.().length
    if (!hasChanges.value && !queue.version && !firstChangeAt && !pending && !uploads.value.length) return 'unnecessary'
    // 等待写入期间可能收到远端编辑或图片完成通知，必须再核对完整状态。
    for (let attempt = 0; attempt < 3; attempt++) {
      const signature = backupSignature()
      if (await persistLocal(true)) {
        if (signature === backupSignature()) return 'local'
        continue
      }
      // 个人草稿接口不保存图片二进制；没有本地副本时不能只凭正文同步放行。
      if (uploads.value.length) break
      try {
        await options.collaboration?.flush?.()
        if (options.collaboration?.edits?.().length) break
        const saved = await sync(true)
        if (saved && !uploads.value.length && !options.collaboration?.edits?.().length && cloudFingerprint.value === fingerprint.value) return 'server'
      } catch { /* 统一提示并留在当前页，允许用户再次尝试。 */ }
      break
    }
    navigationError.value = '当前修改尚未完整备份，请检查网络或本机存储后重试切换。'
    return 'blocked'
  }

  let navigationTarget = ''
  watch(() => options.active?.value, active => {
    updateSyncInterval()
    if (active !== false) return
    navigationPending.value = false
    navigationTarget = ''
  }, { flush: 'sync' })
  async function guardNavigation(to: { fullPath: string }) {
    if (navigationPending.value) return false
    navigationTarget = to.fullPath
    navigationPending.value = true
    try {
      const allowed = await prepareLeave() !== 'blocked'
      if (!allowed) navigationPending.value = false
      return allowed
    } catch {
      navigationPending.value = false
      navigationError.value = '当前修改尚未完整备份，请重试切换。'
      return false
    }
  }

  const router = useRouter()
  // 放行后保持锁定直到停用/卸载；取消和失败只释放对应导航的锁。
  const removeAfterEach = router.afterEach((to, _from, failure) => {
    if (failure && to.fullPath === navigationTarget) navigationPending.value = false
  })
  const removeOnError = router.onError((_error, to) => {
    if (to.fullPath === navigationTarget) navigationPending.value = false
  })

  async function flush() { await persistLocal(); await sync() }
  function visibility() {
    if (document.visibilityState === 'hidden') {
      if (options.active?.value === false) void persistLocal()
      else void flush()
    }
  }
  function online() { if (options.active?.value !== false) { lastAttempt = 0; void retry() } }
  function updateSyncInterval() {
    clearInterval(interval)
    interval = undefined
    if (!ready.value || disposed || options.active?.value === false) return
    interval = setInterval(() => {
      const base = storage && !localError.value ? 30_000 : 5_000
      const delay = Math.min(120_000, base * 2 ** Math.min(failures, 3))
      if (!syncing.value && !busy.value && document.visibilityState === 'visible' && Date.now() - lastAttempt >= delay) void sync()
    }, 5000)
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    void persistLocal()
    if (needsBackup.value) { event.preventDefault(); event.returnValue = '' }
  }
  onBeforeRouteLeave(guardNavigation)
  onBeforeRouteUpdate((to, from) => String(to.params.id) === String(from.params.id) ? true : guardNavigation(to))
  onMounted(async () => {
    baseline.value = reconcile()
    try { storage = await DraftStorage.open() }
    catch { localError.value = '本地保存不可用，请保持联网，等待服务器同步完成。' }
    if (disposed) { storage?.close(); return }
    let previousId: string | undefined
    try { previousId = await recoverSavedDraft() }
    catch (error) { recoveryError.value = `恢复未保存内容失败：${draftError(error)}` }
    try { await prepareCollaboration() }
    catch (error) { preparationFailed = true; recoveryError.value = `协作连接失败：${draftError(error)}` }
    if (disposed) { storage?.close(); return }
    ready.value = true
    lastAttempt = Date.now()
    if (firstChangeAt) {
      const saved = await persistLocal()
      if (saved && previousId) await storage?.remove(previousId, options.userId).catch(() => undefined)
    } else reconcile()
    if (disposed) return
    updateSyncInterval()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', online)
    window.addEventListener('pagehide', visibility)
  })
  watch(needsBackup, value => {
    if (!import.meta.client && typeof window === 'undefined') return
    if (value) window.addEventListener('beforeunload', beforeUnload)
    else window.removeEventListener('beforeunload', beforeUnload)
  }, { flush: 'sync' })
  onBeforeUnmount(() => {
    removeAfterEach(); removeOnError()
    void persistLocal()
    disposed = true
    clearTimeout(localTimer); clearTimeout(localDeadline); clearTimeout(checkTimer); clearInterval(interval)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('online', online)
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('pagehide', visibility)
    void localWrite.finally(() => storage?.close()).catch(() => undefined)
  })

  return { ready, canRetry, id, uploads, editorKey, localError, cloudError, recoveryError, syncing, busy,
    navigationPending, navigationError, prepareLeave,
    hasChanges, needsBackup, status, localTime, cloudTime, fingerprint, snapshot, setUploads, persistLocal,
    sync, retry, ensureServerDraft, prepareVersion, versionSaved, archiveRecovery, scheduleLocalBackup: changed }
}
