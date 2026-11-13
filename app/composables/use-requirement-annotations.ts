import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { ANNOTATION_FORMAT, ANNOTATION_REQUIREMENTS, MAX_ANNOTATIONS, annotationFingerprint, formatAnnotationRequest, parseAnnotationRequest, resolveAnnotation, validateAnnotation, type AiAnnotation, type AnnotationCompletion } from '~~/shared/agent/annotations'
import { collaborationSignature } from '~~/shared/collaboration/document'
import { cloneRichTextDocument, type RichTextDocument } from '~~/shared/editor/document'
import { useActiveVisualEffect } from './use-active-visual-effect'

export function useRequirementAnnotations(options: {
  userId: Ref<string>; requirementId: Ref<string>; key: Ref<string>; title: Ref<string>; content: Ref<RichTextDocument>
  flush: () => Promise<void>; canCopy: () => boolean; hasPendingEdits: () => boolean
  editingId?: Ref<string>
  active?: Ref<boolean>
  fetchCompletions?: (annotations: AnnotationCompletion[], signal: AbortSignal) => Promise<{ completed: AnnotationCompletion[] }>
  acknowledgeCompletions?: (annotations: AnnotationCompletion[]) => Promise<unknown>
  onCompleted?: (count: number) => void
}) {
  const notes = ref<AiAnnotation[]>([]), overall = ref(''), activeId = ref('')
  const storageError = ref(''), error = ref(''), busy = ref(false), copied = ref(false), preview = ref('')
  const completionError = ref('')
  const completionChecking = ref(false)
  const storageKey = computed(() => `rb-ai-annotations:v1:${encodeURIComponent(options.userId.value)}:${encodeURIComponent(options.requirementId.value)}`)
  let loading = true
  let localWriteFailed = false
  let revision = 0
  let disposed = false, completionGeneration = 0
  let completionController: AbortController | undefined
  let completionTimer: ReturnType<typeof setTimeout> | undefined
  const resolutions = computed(() => notes.value.map(note => {
    const resolved = resolveAnnotation(note, options.content.value)
    return resolved.status === 'unresolved' && completionChecking.value ? { ...resolved, reason: '正在核对处理结果…' } : resolved
  }))
  function load() {
    loading = true
    localWriteFailed = false
    notes.value = []; overall.value = ''; activeId.value = ''; storageError.value = ''; completionError.value = ''
    try {
      const raw = localStorage.getItem(storageKey.value)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.version !== 1 || !Array.isArray(data.notes) || data.notes.length > MAX_ANNOTATIONS || typeof data.overall !== 'string' || data.overall.length > 2000) throw new Error()
        const ids = new Set()
        notes.value = data.notes.map((note: unknown) => {
          const value = validateAnnotation(note)
          if (ids.has(value.id)) throw new Error()
          ids.add(value.id)
          return value
        })
        overall.value = data.overall
      }
    } catch { storageError.value = '本机标注未能读取，请检查浏览器存储。' }
    loading = false
  }
  useActiveVisualEffect(() => options.active?.value !== false, () => {
    // 写入失败的标注只存在于内存，恢复缓存时不能用旧存储覆盖它。
    if (!localWriteFailed) load()
    window.addEventListener('focus', scheduleCompletions)
    window.addEventListener('online', scheduleCompletions)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)
    scheduleCompletions()
    return () => {
      completionGeneration++
      completionController?.abort(); clearTimeout(completionTimer)
      completionChecking.value = false
      window.removeEventListener('focus', scheduleCompletions)
      window.removeEventListener('online', scheduleCompletions)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  })
  watch(storageKey, () => { if (typeof window !== 'undefined') load() }, { flush: 'sync' })
  watch([notes, overall], () => {
    if (loading || !options.userId.value) return
    try { localStorage.setItem(storageKey.value, JSON.stringify({ version: 1, notes: notes.value, overall: overall.value })); storageError.value = ''; localWriteFailed = false }
    catch { localWriteFailed = true; storageError.value = '标注暂未保存到本机，关闭页面前请先复制。' }
  }, { deep: true, flush: 'sync' })
  watch([notes, overall, options.content, options.title], () => { revision++; copied.value = false; preview.value = ''; error.value = '' }, { deep: true, flush: 'sync' })
  watch([notes, overall, () => options.editingId?.value, storageKey], scheduleCompletions, { deep: true, flush: 'sync' })
  watch(options.content, () => {
    if (notes.value.some(note => resolveAnnotation(note, options.content.value).status === 'unresolved')) scheduleCompletions()
  }, { flush: 'sync' })
  function onVisibility() { if (document.visibilityState === 'visible') scheduleCompletions() }
  function onStorage(event: StorageEvent) { if (!localWriteFailed && event.storageArea === localStorage && event.key === storageKey.value) { load(); scheduleCompletions() } }
  function scheduleCompletions() {
    completionGeneration++
    completionController?.abort()
    clearTimeout(completionTimer)
    completionChecking.value = false
    if (!notes.value.length) completionError.value = ''
    if (!disposed && options.active?.value !== false && options.fetchCompletions && notes.value.length) {
      completionChecking.value = true
      completionTimer = setTimeout(() => { void refreshCompletions() }, 150)
    }
  }
  async function refreshCompletions() {
    clearTimeout(completionTimer)
    const generation = ++completionGeneration
    completionController?.abort()
    if (disposed || localWriteFailed || options.active?.value === false || !options.fetchCompletions || !options.userId.value || !notes.value.length) { completionChecking.value = false; return }
    completionChecking.value = true
    const owner = storageKey.value
    const before = JSON.stringify([notes.value, overall.value, options.editingId?.value])
    const controller = new AbortController()
    completionController = controller
    let timeout: ReturnType<typeof setTimeout> | undefined
    const current = () => !disposed && generation === completionGeneration && owner === storageKey.value
      && before === JSON.stringify([notes.value, overall.value, options.editingId?.value])
    try {
      const storageBefore = localStorage.getItem(owner)
      if (!storageError.value) {
        const saved = storageBefore ? JSON.parse(storageBefore) : { notes: [], overall: '' }
        if (JSON.stringify([saved.notes, saved.overall]) !== JSON.stringify([notes.value, overall.value])) { load(); scheduleCompletions(); return }
      }
      const requested = await Promise.all(notes.value.map(async note => ({ id: note.id, fingerprint: await annotationFingerprint(note, overall.value) })))
      if (!current()) return
      const result = await Promise.race([options.fetchCompletions(requested, controller.signal), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('核对超时')) }, 15_000)
      })])
      if (!current()) return
      // 另一个标签页可能刚刚保存了新要求，先同步它，不能用旧内存状态覆盖。
      if (localStorage.getItem(owner) !== storageBefore) { load(); scheduleCompletions(); return }
      completionError.value = ''
      const fingerprints = new Map(requested.map(item => [item.id, item.fingerprint]))
      const completed = new Set(result.completed.filter(item => fingerprints.get(item.id) === item.fingerprint && item.id !== options.editingId?.value).map(item => item.id))
      if (!completed.size) return
      const remaining = notes.value.filter(note => !completed.has(note.id))
      const saved = JSON.stringify({ version: 1, notes: remaining, overall: overall.value })
      // 先持久化，存储失败不能确认回执，否则刷新后旧标注再也无法自动清除。
      try { localStorage.setItem(owner, saved) }
      catch { completionError.value = '未能保存标注清理结果，标注和完成回执已保留，请恢复浏览器存储后重试。'; return }
      if (localStorage.getItem(owner) !== saved) { load(); scheduleCompletions(); return }
      loading = true
      try { notes.value = remaining } finally { loading = false }
      storageError.value = ''
      if (completed.has(activeId.value)) activeId.value = ''
      options.onCompleted?.(completed.size)
      // 已落盘的清理不回滚；确认丢失时由服务端到期回收，不增加本机任务队列。
      try { await options.acknowledgeCompletions?.(requested.filter(item => completed.has(item.id))) }
      catch { /* 网页已清除，未收到确认的完成信息由服务端保留期兜底。 */ }
    } catch {
      if (current()) completionError.value = '暂未能核对 AI 处理结果，标注已保留，连接恢复或回到页面时会重试。'
    } finally {
      clearTimeout(timeout)
      if (generation === completionGeneration) completionChecking.value = false
    }
  }
  onBeforeUnmount(() => {
    disposed = true; completionGeneration++
    completionController?.abort(); clearTimeout(completionTimer)
    window.removeEventListener('focus', scheduleCompletions)
    window.removeEventListener('online', scheduleCompletions)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('storage', onStorage)
  })
  function upsert(note: AiAnnotation) {
    validateAnnotation(note)
    if (!note.comment.trim()) throw new Error('请填写标注要求。')
    const index = notes.value.findIndex(value => value.id === note.id)
    if (index < 0 && notes.value.length >= MAX_ANNOTATIONS) throw new Error('每份文档最多保留 30 条标注，请先整理已有标注。')
    if (index < 0) notes.value.push(note)
    else notes.value[index] = note
    activeId.value = note.id
  }
  function remove(id: string) {
    notes.value = notes.value.filter(note => note.id !== id)
    if (activeId.value === id) activeId.value = ''
  }
  function clear() {
    notes.value = []
    activeId.value = ''
    completionError.value = ''
  }
  async function prepare() {
    const owner = storageKey.value
    if (!options.canCopy()) throw new Error('请等待共同草稿连接恢复并完成同步后再复制。')
    await options.flush()
    if (owner !== storageKey.value || !options.canCopy() || options.hasPendingEdits()) throw new Error('共同草稿尚未同步，请稍后再试。')
    const fingerprint = JSON.stringify([options.title.value, options.content.value, notes.value, overall.value])
    const document = cloneRichTextDocument(options.content.value)
    const title = options.title.value
    const annotations: AiAnnotation[] = notes.value.map(note => {
      const resolved = resolveAnnotation(note, document)
      if (resolved.status === 'unresolved') throw new Error(`标注 ${notes.value.indexOf(note) + 1}：${resolved.reason}`)
      // 保留复制时的原始定位依据，执行时再以最新快照重新定位。
      return { ...note, target: note.target ?? { type: 'text' } }
    })
    const completion = await Promise.all(annotations.map(async note => ({ id: note.id, fingerprint: await annotationFingerprint(note, overall.value, ANNOTATION_FORMAT) })))
    const contentToken = `3:${await collaborationSignature({ title, contentJson: document })}`
    if (owner !== storageKey.value || !options.canCopy() || options.hasPendingEdits() || fingerprint !== JSON.stringify([options.title.value, options.content.value, notes.value, overall.value])) throw new Error('正文或标注刚刚发生变化，请重新复制。')
    const origin = window.location.origin
    const text = formatAnnotationRequest({ format: ANNOTATION_FORMAT, requirements: ANNOTATION_REQUIREMENTS, source: 'shared-draft', contentToken, createdAt: new Date().toISOString(),
      document: { id: options.requirementId.value, key: options.key.value, title, origin, url: `${origin}/requirements/${encodeURIComponent(options.requirementId.value)}` },
      overall: overall.value, annotations, completion })
    return text
  }
  function markExported(text: string) {
    const request = parseAnnotationRequest(text)
    const next = notes.value.map(note => ({ ...note, target: note.target ?? { type: 'text' as const } }))
    if (request.document.id !== options.requirementId.value || request.overall !== overall.value
      || JSON.stringify(request.annotations) !== JSON.stringify(next)) return false
    // 只有实际复制才迁移旧摘要；打开预览或剪贴板失败仍能匹配原 v1 回执。
    if (notes.value.some(note => !note.target)) notes.value = next
    return true
  }
  function previewCopied() {
    const text = preview.value
    if (!text || !markExported(text)) return
    preview.value = text
    copied.value = true
  }
  async function exportRequest(copy: boolean) {
    if (busy.value) return
    busy.value = true; error.value = ''; copied.value = false
    let preparedRevision = -1
    const prepared = prepare().then(text => { preparedRevision = revision; return text })
    // 立即订阅拒绝；剪贴板 API 可能在读取 Blob Promise 前就拒绝权限。
    void prepared.catch(() => {})
    try {
      if (copy) {
        try {
          if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            const blob = prepared.then(text => new Blob([text], { type: 'text/plain' }))
            void blob.catch(() => {})
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
          } else await navigator.clipboard.writeText(await prepared)
          copied.value = preparedRevision === revision && markExported(await prepared)
          if (!copied.value) error.value = '已复制，但正文或标注随后有变化，请重新复制最新内容。'
        } catch (clipboardError) {
          const text = await prepared
          if (preparedRevision !== revision) throw new Error('正文或标注刚刚发生变化，请重新复制。')
          preview.value = text
          error.value = '剪贴板不可用，已打开预览，请选中并手动复制。'
          return
        }
      } else {
        const text = await prepared
        if (preparedRevision !== revision) throw new Error('正文或标注刚刚发生变化，请重新预览。')
        preview.value = text
      }
    } catch (failure) { error.value = failure instanceof Error ? failure.message : '准备标注失败，请重试。' }
    finally { busy.value = false }
  }
  return { notes, overall, activeId, storageError, error, completionError, completionChecking, busy, copied, preview, resolutions, upsert, remove, clear, exportRequest, previewCopied, refreshCompletions }
}
