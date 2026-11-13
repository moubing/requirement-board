import { HocuspocusProvider } from '@hocuspocus/provider'
import { computed, markRaw, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { nanoid } from 'nanoid'
import { collaborationFingerprint, collaborationSignature, createCollaborationDocument, decodeCollaborationState, encodeCollaborationState, readCollaborationDocument } from '#shared/collaboration/document'
import { useRequirementDraft } from './use-requirement-draft'
import { createCollaborationSignatureTracker } from '../utils/collaboration-signature'
import { detailReturnTiming } from '../utils/detail-return-timing'
import { CollaborationEditQueue, CollaborationEditRecorder } from '../utils/collaboration-edit-queue'
import { emptyAttribution, newerAttribution, type AttributionSnapshot, type AttributionState } from '#shared/collaboration/attribution'
import type { AgentLockDto } from '#shared/agent/lock'
import { draftError } from '#shared/drafts/document'
import { isBlockNode, type RichTextDocument, type RichTextNode } from '#shared/editor/document'
import { DOCUMENT_NODE_CAPABILITIES } from '#shared/editor/capabilities'

export interface CollaborativeEditorOptions {
  document: Y.Doc
  provider: HocuspocusProvider
  user: { id: string; name: string; color: string }
}

type Options = Omit<Parameters<typeof useRequirementDraft>[0], 'collaboration'> & {
  user: CollaborativeEditorOptions['user']
  isEditing?: Ref<boolean>
  canManageLocks?: boolean
  onRevision: (message: { mutationId?: string }) => void
  onProperties?: (message: { mutationId?: string }) => void
}

interface ResumeState {
  state: string
  editEpoch: number
  agentLock: AgentLockDto | null
  signature: string
  updatedAt: string
  attribution?: AttributionSnapshot
  attributionSequence?: number
}

function timedRequestSignal(signal: AbortSignal) {
  // ofetch 1.x 传入 signal 时会忽略 timeout，必须显式合并页面取消与超时信号。
  return AbortSignal.any([signal, AbortSignal.timeout(15_000)])
}

function hasDuplicateBlockIds(document: RichTextDocument) {
  const ids = new Set<string>()
  const visit = (node: RichTextNode): boolean => {
    const id = node.attrs?.diffId
    if (isBlockNode(node) && typeof id === 'string' && id) {
      if (ids.has(id)) return true
      ids.add(id)
    }
    return node.content?.some(visit) ?? false
  }
  return document.content.some(visit)
}

export function useRequirementCollaboration(options: Options) {
  const document = shallowRef<Y.Doc>()
  const provider = shallowRef<HocuspocusProvider>()
  const connection = ref('connecting')
  const connectionError = ref('')
  const migrationNotice = ref('')
  const signature = ref('')
  const savedSignature = ref('')
  const savedAt = ref('')
  let savedSequence = -1
  const participants = ref<CollaborativeEditorOptions['user'][]>([])
  let disposed = false
  let confirmedDocument: Y.Doc | undefined
  let awareness: Awareness | undefined
  let edits: CollaborationEditQueue | undefined
  let recorder: CollaborationEditRecorder | undefined
  let sendTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  const requestController = new AbortController()
  const pendingEdits = ref(0)
  const editingError = ref('')
  const epochConflict = ref(false)
  const editEpoch = ref(0)
  let latestEpoch = 0
  const agentLock = shallowRef<AgentLockDto | null>(null)
  const lockError = ref('')
  const releasingLock = ref(false)
  let lockTimer: ReturnType<typeof setTimeout> | undefined
  const resuming = ref(false)
  const resumePending = ref(false)
  let activation = 0
  let resumeController: AbortController | undefined
  let preparedResume: { controller: AbortController; sourceSignal: AbortSignal; promise: Promise<ResumeState> } | undefined
  const active = () => options.active?.value !== false
  const readOnly = computed(() => !active() || resuming.value || Boolean(agentLock.value) || epochConflict.value)
  const canReleaseLock = computed(() => Boolean(agentLock.value && (options.canManageLocks || agentLock.value.userId === options.userId)))
  const attribution = shallowRef<AttributionState>()
  const confirmedOrigin = Symbol('confirmed-collaboration')
  let documentGeneration = 0
  let backupGeneration = 0
  let encodedState: { generation: number; state: string } | undefined
  function captureState() {
    if (!document.value) return undefined
    if (encodedState?.generation !== documentGeneration) encodedState = { generation: documentGeneration, state: encodeCollaborationState(document.value) }
    return encodedState.state
  }

  function freezeOldEdits(message = '本机有锁定前尚未同步的修改，已保留副本。请导出后载入当前草稿，再核对需要补回的内容。') {
    if (epochConflict.value) return
    epochConflict.value = true
    recorder?.flush()
    clearTimeout(sendTimer); sendTimer = undefined
    editingError.value = message
    void draft.persistLocal(true)
  }

  function receiveEpoch(next: number) {
    if (!Number.isSafeInteger(next) || next < latestEpoch) return
    latestEpoch = next
    if (next === editEpoch.value || epochConflict.value) return
    recorder?.flush()
    if (edits?.size) freezeOldEdits()
    else {
      editEpoch.value = next
      editingError.value = ''
      void draft.persistLocal(true)
    }
  }

  function receiveLock(next: { lock: AgentLockDto | null; editEpoch: number }) {
    if (next.editEpoch < latestEpoch || disposed) return
    clearTimeout(lockTimer)
    agentLock.value = next.lock
    if (next.lock) { clearTimeout(sendTimer); sendTimer = undefined }
    receiveEpoch(next.editEpoch)
    if (next.lock && active()) {
      // 仅锁定期间检查凭证撤销及到期；到期由服务器确认后再恢复编辑。
      const delay = Math.min(10_000, Math.max(250, Date.parse(next.lock.expiresAt) - Date.now() + 50))
      lockTimer = setTimeout(() => { void refreshLock() }, delay)
    } else scheduleSend()
  }

  async function refreshLock() {
    if (!active() || disposed) return
    try {
      const next = await $fetch<{ lock: AgentLockDto | null; editEpoch: number }>(`/api/requirements/${options.requirementId}/agent-lock`,
        { retry: 0, signal: timedRequestSignal(requestController.signal) })
      if (!disposed) { lockError.value = ''; receiveLock(next) }
    } catch {
      if (!disposed && active() && agentLock.value) {
        lockError.value = '暂时无法确认锁状态，连接恢复后会自动检查。'
        lockTimer = setTimeout(() => { void refreshLock() }, 10_000)
      }
    }
  }

  async function releaseLock() {
    if (!agentLock.value || !canReleaseLock.value || releasingLock.value) return
    releasingLock.value = true; lockError.value = ''
    try {
      const next = await $fetch<{ lock: AgentLockDto | null; editEpoch: number }>(`/api/requirements/${options.requirementId}/agent-lock`,
        { method: 'POST', body: { snapshotId: agentLock.value.snapshotId }, retry: 0, timeout: 15_000 })
      receiveLock(next)
    } catch { await refreshLock(); if (agentLock.value) lockError.value = '取消失败，请重试。' }
    finally { releasingLock.value = false }
  }

  function receiveAttribution(next: AttributionState) {
    if (newerAttribution(next, attribution.value)) attribution.value = next
  }
  function receiveSaved(next: { signature: string; updatedAt: string; sequence?: number }) {
    if (next.sequence != null ? next.sequence < savedSequence : next.updatedAt < savedAt.value) return
    if (next.sequence !== savedSequence || next.signature !== savedSignature.value) backupGeneration++
    if (next.sequence != null) savedSequence = next.sequence
    savedSignature.value = next.signature
    savedAt.value = next.updatedAt
    // HTTP 与 WebSocket 的重复确认不能绕过输入侧的合并窗口。
    signatureTracker.schedule()
  }
  function scheduleSend(delay = 16) {
    if (disposed || readOnly.value || sendTimer || !edits?.size) return
    sendTimer = setTimeout(() => {
      sendTimer = undefined
      void flushEdits().catch(() => scheduleSend(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))))
    }, delay)
  }
  async function flushEdits() {
    if (disposed) return
    if (epochConflict.value) throw new Error(editingError.value)
    if (agentLock.value) return
    recorder?.flush()
    clearTimeout(sendTimer); sendTimer = undefined
    try {
      await edits?.flush()
      failures = 0
      if (!epochConflict.value) editingError.value = ''
    } catch (error) {
      const detail = (error as { data?: { data?: { code?: string; lock?: AgentLockDto } } }).data?.data
      if (detail?.code === 'EDIT_EPOCH_CHANGED') freezeOldEdits()
      if (detail?.code === 'REQUIREMENT_LOCKED') {
        if (detail.lock) agentLock.value = detail.lock
        freezeOldEdits()
        void refreshLock()
      }
      failures++
      if (!epochConflict.value) {
        const failure = error as { statusCode?: number; status?: number; data?: { statusCode?: number } }
        const statusCode = failure?.statusCode ?? failure?.status ?? failure?.data?.statusCode
        editingError.value = statusCode
          ? `编辑同步未完成（${draftError(error)}），修改与作者记录保留在本机。`
          : '编辑同步暂未完成，修改与作者记录保留在本机，联网后重试。'
      }
      if ((error as { cause?: { name?: string } })?.cause?.name === 'TimeoutError') {
        throw new Error('正文同步超时，修改已保留，请检查网络后重试')
      }
      throw error
    }
  }
  const signatureTracker = createCollaborationSignatureTracker(
    async () => document.value ? collaborationSignature(readCollaborationDocument(document.value)) : '',
    next => { signature.value = next },
  )

  const draft = useRequirementDraft({ ...options, collaboration: {
    flush: flushEdits,
    state: captureState,
    generation: () => { recorder?.flush(); return backupGeneration },
    epoch: () => editEpoch.value,
    edits: () => { recorder?.flush(); return edits?.snapshot() ?? [] },
    async initialize(state, recovered, recoveredEdits, recoveredEpoch) {
      if (document.value) return
      const initial = { title: options.title.value, contentJson: options.content.value }
      const loaded = await $fetch<{ state: string; editEpoch: number; agentLock?: AgentLockDto | null; initialized: boolean; signature: string; updatedAt: string; attribution?: AttributionSnapshot; attributionSequence?: number }>(
        `/api/requirements/${options.requirementId}/collaboration`, {
          method: 'POST', body: recovered && !state ? { initial } : {}, timeout: 15_000, retry: 0,
        })
      if (disposed) return
      let doc = new Y.Doc()
      // Backups written before the epoch field was introduced belong to epoch 0.
      const localEpoch = recoveredEpoch ?? 0
      // 已确认的旧检查点直接跟随当前草稿，只有仍携带本机增量时才需要人工恢复。
      const staleRecovery = Boolean(state && localEpoch !== loaded.editEpoch && recoveredEdits?.length !== 0)
      editEpoch.value = staleRecovery ? localEpoch : loaded.editEpoch
      latestEpoch = loaded.editEpoch
      agentLock.value = loaded.agentLock ?? null
      Y.applyUpdate(doc, decodeCollaborationState(staleRecovery ? state! : loaded.state))
      // Provider 只持有服务端确认的副本。它的重连 SyncStep2 不会偷跑尚未归属的本地修改。
      confirmedDocument = new Y.Doc()
      Y.applyUpdate(confirmedDocument, decodeCollaborationState(loaded.state))
      receiveAttribution({ sequence: loaded.attributionSequence ?? 0, snapshot: loaded.attribution ?? emptyAttribution() })
      let conflictingHistory = false
      if (state && !staleRecovery && localEpoch === loaded.editEpoch) {
        Y.applyUpdate(doc, decodeCollaborationState(state))
        // 同样的 JSON 不代表同一条 Yjs 历史。旧副本可能携带独立初始化的整篇正文，
        // 不能把合并产生的重复块修成新 ID 后当作正常编辑提交，也不能覆盖原恢复副本。
        if (hasDuplicateBlockIds(readCollaborationDocument(doc).contentJson)) {
          conflictingHistory = true
          doc.destroy()
          doc = new Y.Doc()
          Y.applyUpdate(doc, decodeCollaborationState(state))
        }
      }
      let preserveLegacy = false
      if (recovered && !state && !loaded.initialized) {
        const legacy = createCollaborationDocument(initial)
        preserveLegacy = collaborationFingerprint(readCollaborationDocument(legacy)) !== collaborationFingerprint(readCollaborationDocument(doc))
        legacy.destroy()
        if (preserveLegacy) migrationNotice.value = '本机保留了接入协作前的独立草稿，未用它替换当前草稿。'
      }
      document.value = markRaw(doc)
      if (staleRecovery) freezeOldEdits()
      else if (conflictingHistory) freezeOldEdits('本机草稿与当前文档的协作历史冲突，存在重复内容，原副本已保留。请导出后载入当前草稿，再核对需要补回的内容。')
      const current = readCollaborationDocument(doc)
      options.content.value = current.contentJson
      doc.on('update', () => { documentGeneration++; backupGeneration++; signatureTracker.changed() })
      await signatureTracker.refresh()
      if (disposed) return
      receiveSaved({ ...loaded, sequence: loaded.attributionSequence ?? 0 })
      edits = new CollaborationEditQueue(async batch => {
        if (disposed) throw new Error('编辑器已关闭')
        if (readOnly.value) throw new Error('当前文档只读，修改已保留在本机')
        const vector = Y.encodeStateVector(confirmedDocument!)
        let binary = ''
        for (const byte of vector) binary += String.fromCharCode(byte)
        const stateVector = btoa(binary)
        const response = await $fetch<AttributionState & { accepted: string[]; update: string; signature: string; updatedAt: string }>(
          `/api/requirements/${options.requirementId}/edits`, { method: 'POST', body: { schemaVersion: 3, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES, edits: batch, stateVector, editEpoch: editEpoch.value },
            retry: 0, signal: timedRequestSignal(requestController.signal) })
        if (batch.some(edit => !response.accepted.includes(edit.id))) throw new Error('编辑确认不完整')
        if (disposed) return
        Y.applyUpdate(confirmedDocument!, decodeCollaborationState(response.update), provider.value)
        receiveAttribution(response)
        receiveSaved(response)
      }, recoveredEdits, () => {
        backupGeneration++
        pendingEdits.value = edits?.size ?? 0
        // 正文和待确认事件进入同一份 IndexedDB 检查点；包括撤销后正文恰好回到基线的情况。
        draft.scheduleLocalBackup()
        scheduleSend()
      })
      const replayed = new Y.Doc()
      try {
        Y.applyUpdate(replayed, decodeCollaborationState(loaded.state))
        for (const edit of recoveredEdits ?? []) Y.applyUpdate(replayed, decodeCollaborationState(edit.update))
        if (!epochConflict.value && !Y.equalSnapshots(Y.snapshot(replayed), Y.snapshot(doc))) {
          edits.push({ id: `edit_${nanoid(24)}`, clientId: doc.clientID, intent: 'legacy',
            update: encodeCollaborationState(doc) })
        }
      } finally { replayed.destroy() }
      pendingEdits.value = edits.size
      recorder = new CollaborationEditRecorder(edits)
      confirmedDocument.on('update', (update: Uint8Array) => {
        if (!epochConflict.value) Y.applyUpdate(doc, update, confirmedOrigin)
      })
      doc.on('update', (update: Uint8Array, _origin: unknown, _document: Y.Doc, transaction: Y.Transaction) => {
        if (!transaction.local || disposed) return
        recorder!.record(update, doc.clientID, transaction.origin instanceof Y.UndoManager ? 'restore' : 'edit')
      })
      provider.value = markRaw(new HocuspocusProvider({
        url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/collaboration?schemaVersion=3&schemaCapabilities=${DOCUMENT_NODE_CAPABILITIES.join(',')}`,
        // 用约一帧的时间窗口合并正文与光标更新，避免按 100 毫秒成批显示字符。
        name: options.requirementId, document: confirmedDocument, awareness: awareness = new Awareness(confirmedDocument), flushDelay: 16,
        onStatus: ({ status }) => { connection.value = status },
        onAuthenticated: () => {
          if (!active()) { provider.value?.disconnect(); return }
          connectionError.value = ''
          awareness?.setLocalStateField('user', options.user)
          awareness?.setLocalStateField('editing', !readOnly.value && (options.isEditing?.value ?? true))
          scheduleSend()
        },
        onAuthenticationFailed: () => {
          connectionError.value = '协作连接未通过验证，请检查登录状态后重试。'
          connection.value = 'disconnected'
        },
        onAwarenessChange: ({ states }) => {
          const users = new Map<string, CollaborativeEditorOptions['user']>()
          for (const state of states) if (state.user?.id && state.editing !== false) users.set(state.user.id, state.user)
          const next = [...users.values()].sort((left, right) => left.id.localeCompare(right.id))
          const previous = participants.value
          if (next.length !== previous.length || next.some((user, index) => {
            const existing = previous[index]
            return user.id !== existing?.id || user.name !== existing.name || user.color !== existing.color
          })) participants.value = next
        },
        onStateless: ({ payload }) => {
          try {
            const message = JSON.parse(payload)
            if (message.type === 'epoch') receiveEpoch(message.editEpoch)
            if (message.type === 'agent-lock' && Number.isSafeInteger(message.editEpoch)) receiveLock(message)
            if (message.type === 'attribution') receiveAttribution(message)
            if (message.type === 'saved' && typeof message.signature === 'string') {
              receiveSaved(message)
            }
            if (message.type === 'revision') options.onRevision(message)
            if (message.type === 'properties') options.onProperties?.(message)
          } catch { /* 忽略不属于当前协议的消息。 */ }
        },
      }))
      if (!active()) suspend()
      if (agentLock.value) receiveLock({ lock: agentLock.value, editEpoch: loaded.editEpoch })
      scheduleSend()
      return { preserveLegacy }
    },
  } })

  watch([provider, () => options.isEditing?.value ?? true, readOnly], ([current, editing, locked]) => {
    current?.setAwarenessField('editing', editing && !locked)
  }, { immediate: true, flush: 'sync' })

  function suspend() {
    activation++
    resumePending.value = false
    resumeController?.abort()
    preparedResume?.controller.abort()
    preparedResume = undefined
    recorder?.flush()
    clearTimeout(sendTimer); sendTimer = undefined
    clearTimeout(lockTimer); lockTimer = undefined
    awareness?.setLocalState(null)
    provider.value?.disconnect()
    participants.value = []
    connection.value = 'disconnected'
    // 离页守卫已经保证可恢复；若最后一个确认/上传在停用时到达，仍补存完整副本。
    void draft.persistLocal()
  }

  function fetchResumeState(signal: AbortSignal) {
    const endFetch = detailReturnTiming(options.requirementId)?.start('collaboration-fetch')
    return $fetch<ResumeState>(`/api/requirements/${options.requirementId}/collaboration`,
      { method: 'POST', body: {}, retry: 0, signal: timedRequestSignal(signal) }).finally(() => endFetch?.())
  }

  // 只预取本次激活的授权响应。详情校验成功并重新 active 后才合并、开放编辑和连接。
  function prepareResume(signal: AbortSignal) {
    if (disposed || active() || !document.value) return
    preparedResume?.controller.abort()
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abort, { once: true })
    const promise = fetchResumeState(controller.signal).finally(() => signal.removeEventListener('abort', abort))
    preparedResume = { controller, sourceSignal: signal, promise }
    // 详情可能先失败；预取失败留给 resume 展示，不产生未处理的 Promise 拒绝。
    void promise.catch(() => {})
  }

  async function resume() {
    if (disposed || !active() || !document.value || !confirmedDocument) return
    const generation = ++activation
    resumeController?.abort()
    const prepared = preparedResume
    preparedResume = undefined
    const usePrepared = prepared && !prepared.controller.signal.aborted && !prepared.sourceSignal.aborted
    const controller = resumeController = usePrepared ? prepared.controller : new AbortController()
    resuming.value = true
    resumePending.value = true
    const timing = detailReturnTiming(options.requirementId)
    try {
      const current = await (usePrepared ? prepared.promise : fetchResumeState(controller.signal))
      if (disposed || !active() || controller.signal.aborted || generation !== activation) return
      const endApply = timing?.start('collaboration-apply')
      // 先校验代次，再合并服务端增量；旧代次未确认输入沿既有恢复流程冻结。
      receiveLock({ lock: current.agentLock, editEpoch: current.editEpoch })
      Y.applyUpdate(confirmedDocument, decodeCollaborationState(current.state), confirmedOrigin)
      receiveAttribution({ sequence: current.attributionSequence ?? 0, snapshot: current.attribution ?? emptyAttribution() })
      receiveSaved({ ...current, sequence: current.attributionSequence ?? 0 })
      endApply?.()
      connectionError.value = ''
      resuming.value = false
      void provider.value?.connect().catch(() => { if (active() && !disposed) connectionError.value = '协作连接失败，请重试。' })
      scheduleSend()
    } catch (error) {
      if (!disposed && active() && generation === activation) {
        connectionError.value = `暂未能重新核对文档，已暂停编辑：${draftError(error)}`
      }
    } finally {
      if (generation === activation) resumePending.value = false
    }
  }
  watch(() => options.active?.value, value => {
    if (value === false) suspend()
    else if (document.value) void resume()
  }, { flush: 'sync' })

  const ready = computed(() => draft.ready.value && Boolean(document.value && provider.value))
  // 恢复失败仍保持只读，但加载反馈只跟随实际等待，不能把只读当作持续加载。
  const restoring = computed(() => !draft.ready.value || (!ready.value && draft.busy.value) || resumePending.value)
  const cloudError = computed(() => connectionError.value || editingError.value || draft.cloudError.value)
  const recoveryError = computed(() => draft.recoveryError.value || migrationNotice.value)
  const status = computed(() => {
    if (epochConflict.value) return '本机修改已保留，待核对'
    if (agentLock.value) return 'AI 正在编辑 · 只读'
    if (cloudError.value) return cloudError.value
    if (!ready.value) return '正在连接协作文档'
    if (!pendingEdits.value && signature.value && savedSignature.value === signature.value) return draft.uploads.value.length
      ? `草稿已同步，${draft.uploads.value.length} 张图片待上传` : '草稿已同步'
    if (connection.value !== 'connected') return draft.needsBackup.value ? '连接中断，正在备份到本机' : '编辑已备份到本机，等待重新连接'
    return '正在同步草稿'
  })
  const editorOptions = computed<CollaborativeEditorOptions | undefined>(() => document.value && provider.value
    ? { document: document.value, provider: provider.value, user: options.user } : undefined)

  async function retry() {
    if (resuming.value) { await resume(); return }
    if (readOnly.value) return
    await draft.retry()
    if (provider.value) await provider.value.connect()
    await flushEdits().catch(() => scheduleSend(2000))
  }

  async function prepareVersion() {
    if (epochConflict.value) throw new Error(editingError.value)
    if (agentLock.value) throw new Error('AI 编辑期间只能查看，暂不能保存版本')
    await draft.persistLocal()
    await flushEdits()
    return draft.prepareVersion()
  }

  function attributionSnapshot() {
    return attribution.value?.snapshot ?? null
  }

  async function exportRecoveryAndReload() {
    try {
      const pendingUploads = await Promise.all(draft.uploads.value.map(async upload => ({ ...upload,
        file: upload.file ? { type: upload.file.type, bytes: Array.from(new Uint8Array(await upload.file.arrayBuffer())) } : undefined })))
      const recovery = { format: 'requirement-board-recovery-v1', requirementId: options.requirementId, editEpoch: editEpoch.value,
        ...draft.snapshot(), collaborationState: document.value ? encodeCollaborationState(document.value) : undefined,
        collaborationEdits: edits?.snapshot() ?? [], pendingUploads }
      const url = URL.createObjectURL(new Blob([JSON.stringify(recovery, null, 2)], { type: 'application/json' }))
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${options.requirementId}-recovery.json`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      await draft.archiveRecovery()
      location.reload()
    } catch (error) { editingError.value = error instanceof Error ? error.message : '导出失败，请重试' }
  }

  onBeforeUnmount(() => {
    disposed = true
    activation++
    resumeController?.abort()
    preparedResume?.controller.abort()
    preparedResume = undefined
    clearTimeout(sendTimer)
    clearTimeout(lockTimer)
    requestController.abort()
    signatureTracker.destroy()
    awareness?.setLocalState(null)
    provider.value?.destroy()
    if (!provider.value) awareness?.destroy()
    // 本地备份由 draft 的卸载钩子先捕获状态；释放 Y.Doc 不改变已捕获的数据。
    document.value?.destroy()
    confirmedDocument?.destroy()
  })

  return { ...draft, ready, restoring, cloudError, recoveryError, status, cloudTime: savedAt,
    editorOptions, participants, connection, retry, prepareResume, prepareVersion, flushEdits, attributionSnapshot, pendingEdits,
    editEpoch, epochConflict, exportRecoveryAndReload,
    agentLock, readOnly, canReleaseLock, releasingLock, lockError, releaseLock, refreshLock,
    canRetry: computed(() => active() && (resuming.value || (!readOnly.value && draft.canRetry.value))),
    collaborationUpdate: () => document.value ? encodeCollaborationState(document.value) : undefined }
}
