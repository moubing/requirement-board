<script setup lang="ts">
import { useRequirementCache } from '../../composables/use-requirement-cache'
import { computed, nextTick, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from '#app'
import { useRequirementChapterLink } from '../../composables/use-requirement-chapter-link'
import { ArrowRight, ChevronDown, Ellipsis, Flag, Info, PanelRightOpen, SlidersHorizontal, Users } from 'lucide-vue-next'
import { nanoid } from 'nanoid'
import {
  BingButton,
  BingCheckbox,
  BingDialog,
  BingDropDown,
  BingDropDownItem,
  BingIcon,
  BingScrollbar,
  BingSelect,
  BingSplitPane,
  BingTextarea,
  BingTooltip,
  useBingToast,
} from '@moubing/bing-ui'
import type { BingSelectModelValue, BingSelectOption, BingTabValue } from '@moubing/bing-ui'
import { DOCUMENT_TYPE_LABELS, documentAssigneeIds, documentStates } from '#shared/documents/workflow'
import type { RequirementDetailMeta, RequirementDto } from '../../types/requirement-detail'
import { DOCUMENT_NODE_CAPABILITIES } from '#shared/editor/capabilities'
import type { RequirementPropertyPatch } from '#shared/requirements/properties'
import type { RelatedDocumentDto } from '#shared/requirements/relations'
import RelatedDocuments from '../../components/requirements/RelatedDocuments.vue'
import RequirementTitleInput from '../../components/requirements/RequirementTitleInput.vue'
import DocumentPropertiesDialog from '../../components/requirements/DocumentPropertiesDialog.vue'
import { useAppPreferences } from '../../composables/use-app-preferences'
import { createCoalescedRefresh } from '../../utils/coalesced-refresh'
import { afterNextPaint } from '../../utils/after-paint'
import { createLatestPatchQueue } from '../../utils/latest-patch-queue'
import { useOperationFeedback } from '../../composables/use-operation-feedback'
import { detailReturnTiming } from '../../utils/detail-return-timing'
import DocumentAssignees from '../../components/documents/DocumentAssignees.vue'
import SaveDocumentTemplateDialog from '../../components/documents/SaveDocumentTemplateDialog.vue'

import RichRequirementEditor from '../../components/editor/RichRequirementEditor.vue'
import RequirementDocumentLoading from '../../components/editor/RequirementDocumentLoading.vue'
import RequirementEditorToolbarControls from '../../components/editor/RequirementEditorToolbarControls.vue'
import RequirementWorkspaceNav from '../../components/editor/RequirementWorkspaceNav.vue'
import RequirementAuxiliaryPanel from '../../components/editor/RequirementAuxiliaryPanel.vue'
import RequirementOutline from '../../components/editor/RequirementOutline.vue'
import RequirementAnnotations from '../../components/editor/RequirementAnnotations.vue'
import { useRequirementAnnotations } from '../../composables/use-requirement-annotations'
import type { AiAnnotation, AnnotationCompletion } from '#shared/agent/annotations'
import RequirementSaveActions from '../../components/editor/RequirementSaveActions.vue'
import RequirementCollaboratorsPanel from '../../components/editor/RequirementCollaboratorsPanel.vue'
import RequirementAgentLockNotice from '../../components/editor/RequirementAgentLockNotice.vue'
import { useContentModified } from '../../composables/use-content-modified'
import RequirementWorkspaceNotice, { type WorkspaceNotice } from '../../components/editor/RequirementWorkspaceNotice.vue'
import { useRequirementCollaboration } from '../../composables/use-requirement-collaboration'
import { draftError } from '~~/shared/drafts/document'
import RichTextDiffViewer from '../../components/diff/RichTextDiffViewer.vue'
import {
  createSelectionHistoryContextToken,
  removeSelectionHistoryTabContext,
  writeSelectionHistoryTabContext,
} from '../../components/diff/selection-history-tab-context'
import type { RevisionDto, RevisionMetadata, RevisionSummaryDto } from '#shared/requirements/revisions'
import { useRevisionDocuments } from '../../composables/use-revision-documents'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import { resolveComparisonSelection } from '../../components/revision/revision-selection'
import RequirementRevisionSelect from '../../components/revision/RequirementRevisionSelect.vue'
import {
  cloneRichTextDocument,
  createEmptyDocument,
  ensureBlockIds,
  type RichTextDocument,
} from '~~/shared/editor/document'
import { revertDraftChange, type RevertChangePayload } from '~~/shared/diff/revert-draft-change'
import type { SelectionHistoryAnchor } from '~~/shared/diff/selection-history'
import type { VersionMarker } from '~~/shared/diff/version-markers'

interface ImageUploadState {
  uploading: number
  failed: number
}

type RequirementDetailResponse = RequirementDto | (Omit<RequirementDto, 'currentRevision'> & {
  currentRevisionId: string
  currentRevisionUnchanged: true
})

const route = useRoute()
const router = useRouter()
const props = defineProps<{ initialMeta: RequirementDetailMeta; initialRequirement: RequirementDto }>()
// 缓存实例固定文档 ID；账号/项目隔离由 App 中的缓存边界负责。
const requirementId = ref(props.initialRequirement.id)
const pageActive = ref(true)
const pageResuming = ref(false)
const pageResumeError = ref('')
const documentActive = computed(() => pageActive.value && !pageResuming.value)
let activationSequence = 0
let activationRequest: AbortController | undefined
const detailCacheEpoch = useState('requirement-detail-cache-epoch', () => 0)
const index = useRequirementCache()
const recent = useRecentRequirements()
const workspace = useRequirementWorkspace()
const toast = useBingToast()
const feedback = useOperationFeedback()
const accountAccess = useAccountAccessState()

const meta = shallowRef(props.initialMeta)
const requirement = shallowRef(props.initialRequirement)
const revisionsRequest = useFetch<RevisionSummaryDto[]>(
  () => `/api/requirements/${requirementId.value}/revisions`,
  { lazy: true },
)
const requestFetch = useRequestFetch()
let propertyWriteSequence = 0
async function refreshRequirement() {
  const sequence = propertyWriteSequence
  const current = await requestFetch<RequirementDto>(`/api/requirements/${requirementId.value}`, { retry: 0, timeout: 15_000 })
  if (!documentActive.value) return
  if (sequence !== propertyWriteSequence) { void refreshQueue.request(['detail']); return }
  requirement.value = current
}
const relatedUrl = `/api/requirements/${encodeURIComponent(requirementId.value)}/related`
const relatedRequest = useFetch<RelatedDocumentDto[]>(relatedUrl, { lazy: true })
const [
  { data: revisions, refresh: refreshRevisions, error: revisionsError },
  { data: relatedDocuments, pending: relatedLoading, error: relatedError, refresh: refreshRelatedDocuments },
] = await Promise.all([revisionsRequest, relatedRequest])
const ownMutations = new Set<string>()
function trackMutation(id = nanoid(24)) {
  ownMutations.add(id)
  if (ownMutations.size > 500) ownMutations.delete(ownMutations.values().next().value!)
  return id
}
const refreshQueue = createCoalescedRefresh<'detail' | 'related' | 'revisions' | 'index'>(async keys => {
  if (!documentActive.value) return
  if (keys.includes('index')) index.invalidate()
  await Promise.allSettled([
    ...(keys.includes('detail') ? [refreshRequirement()] : []),
    ...(keys.includes('related') ? [refreshRelatedDocuments({ dedupe: 'defer' })] : []),
    ...(keys.includes('revisions') ? [refreshRevisions({ dedupe: 'defer' })] : []),
  ])
})
onBeforeUnmount(() => refreshQueue.dispose())
const relatedSaving = ref(false)
async function changeRelatedDocuments(documentIds: string[], remove = false) {
  if (relatedSaving.value || draft.readOnly.value || draft.navigationPending.value) throw new Error('当前文档暂时无法修改关联，请稍后重试')
  relatedSaving.value = true
  const operation = feedback.begin(`正在${remove ? '解除' : '添加'} ${requirement.value?.key} 的文档关联`)
  try {
    const updated = await $fetch<RelatedDocumentDto[]>(remove ? `${relatedUrl}/${encodeURIComponent(documentIds[0]!)}` : relatedUrl, {
      method: remove ? 'DELETE' : 'POST', ...(remove ? {} : { body: { documentIds } }), retry: 0, timeout: 15_000,
    })
    operation.success(`${requirement.value?.key} 的文档关联已${remove ? '解除' : '更新'}`)
    if (operation.isCurrent()) { relatedDocuments.value = updated; index.invalidate() }
  } catch (cause) {
    operation.error(`文档关联${remove ? '解除' : '更新'}失败：${draftError(cause)}，可重新打开重试。`)
    throw cause
  } finally { relatedSaving.value = false }
}
const addRelatedDocuments = (ids: string[]) => changeRelatedDocuments(ids)
const removeRelatedDocument = (id: string) => changeRelatedDocuments([id], true)
function refreshRelatedOnFocus() { if (!relatedSaving.value) void refreshQueue.request(['related']) }
useActiveVisualEffect(() => documentActive.value, () => {
  window.addEventListener('focus', refreshRelatedOnFocus)
  return () => window.removeEventListener('focus', refreshRelatedOnFocus)
})
const revisionDocuments = useRevisionDocuments((id, signal) => requestFetch<RevisionDto>(`/api/revisions/${encodeURIComponent(id)}`, {
  signal, timeout: 15_000, retry: 0,
}))
watch(() => requirement.value?.currentRevision, revision => { if (revision) revisionDocuments.prime(revision) }, { immediate: true })

const title = ref('')
const titleInput = shallowRef<InstanceType<typeof RequirementTitleInput> | null>(null)
const titleSaving = ref(false)
const content = shallowRef<RichTextDocument>(createEmptyDocument())
const changeNote = ref('')
const editingBaseRevisionId = ref('')
let initializedRequirementId = ''
let versionSaveRequest: { id: string; prepared: Awaited<ReturnType<typeof draft.prepareVersion>>; body: Record<string, unknown> } | null = null
const viewMode = ref<'edit' | 'diff'>(
  route.query.block === undefined && ['history', 'diff'].includes(routeQueryString(route.query.view)) ? 'diff' : 'edit',
)
const hasOpenedDiff = ref(viewMode.value === 'diff')
const requestedView = ref(viewMode.value)
let cancelViewChange: (() => void) | undefined
function setView(value: 'edit' | 'diff') {
  cancelViewChange?.()
  cancelViewChange = undefined
  requestedView.value = value
  viewMode.value = value
}
onBeforeUnmount(() => cancelViewChange?.())
watch(pageActive, active => {
  if (!active) {
    cancelViewChange?.()
    cancelViewChange = undefined
    requestedView.value = viewMode.value
  }
})
watch(viewMode, value => { if (value === 'diff') hasOpenedDiff.value = true })
const agentPanelOpen = ref(false)
const feedbackOpen = ref(false)
const pageRoot = ref<HTMLElement | null>(null)
const editorInstance = shallowRef<InstanceType<typeof RichRequirementEditor> | null>(null)
const pendingToolbar = ref<HTMLElement | null>(null)
const pendingToolbarHeight = ref(48)
const loadingToolbarHeight = computed(() => editorInstance.value?.toolbarHeight ?? pendingToolbarHeight.value)
useActiveVisualEffect(() => pageActive.value && viewMode.value === 'edit' && Boolean(pendingToolbar.value), () => {
  const toolbar = pendingToolbar.value!
  const measure = () => { pendingToolbarHeight.value = Math.ceil(toolbar.getBoundingClientRect().height) }
  const observer = new ResizeObserver(measure)
  observer.observe(toolbar)
  measure()
  return () => observer.disconnect()
})
const auxiliaryPanel = shallowRef<InstanceType<typeof RequirementAuxiliaryPanel> | null>(null)
const panelPinned = ref(true)
const drawerOpen = ref(false)
const panelTab = ref<BingTabValue>('outline')
const appPreferences = useAppPreferences()
const propertyDialogOpen = ref(false)
const collaboratorsOpen = ref(false)
const compactViewport = ref(false)
const compactProperties = ref(false)
const attributesOpen = computed({
  get: () => compactViewport.value ? drawerOpen.value : panelPinned.value,
  set: (value: boolean) => { if (compactViewport.value) drawerOpen.value = value; else panelPinned.value = value },
})
watch(attributesOpen, (open) => {
  if (!open && !compactViewport.value && pageRoot.value?.querySelector('.requirement-side')?.contains(document.activeElement)) {
    void nextTick(() => pageRoot.value?.querySelector<HTMLButtonElement>('.requirement-panel-toggle')?.focus())
  }
})
const saveDialogOpen = ref(false)
const templateDialogOpen = ref(false)
const documentType = computed(() => requirement.value?.documentType ?? 'requirement')
const saveFormId = useId()
const metaError = ref('')
let workspaceResize: ResizeObserver | undefined
const updateCompactViewport = () => {
  const width = pageRoot.value?.clientWidth ?? 0
  compactViewport.value = window.innerWidth <= 960 || width < 920
  compactProperties.value = width < 1120
}
useActiveVisualEffect(() => documentActive.value, () => {
  updateCompactViewport()
  workspaceResize = new ResizeObserver(updateCompactViewport)
  if (pageRoot.value) workspaceResize.observe(pageRoot.value)
  window.addEventListener('resize', updateCompactViewport)
  return () => { workspaceResize?.disconnect(); window.removeEventListener('resize', updateCompactViewport) }
})
watch(compactViewport, () => { drawerOpen.value = false })
const showAttributes = computed(() => viewMode.value === 'edit' && attributesOpen.value)
const dockedPanel = computed(() => attributesOpen.value && !compactViewport.value)
const laidOutViews = ref(new Set([viewMode.value]))
watch(viewMode, view => { laidOutViews.value.add(view); drawerOpen.value = false })
const outlineActive = computed(() => documentActive.value && showAttributes.value && panelTab.value === 'outline')
async function selectHeading(id: string) {
  await editorInstance.value?.outline.scrollToHeading(id, compactViewport.value)
  if (compactViewport.value) drawerOpen.value = false
}
const workspaceTabs = computed(() => [
  { value: 'edit', label: '正文' },
  { value: 'diff', label: '版本比较', disabled: saving.value || unresolvedImageUploadCount.value > 0 },
])
const selectedView = computed({
  get: () => requestedView.value,
  set: (value: BingTabValue) => {
    if (value !== 'edit' && value !== 'diff') return
    cancelViewChange?.()
    requestedView.value = value
    if (value === viewMode.value) { cancelViewChange = undefined; return }
    cancelViewChange = afterNextPaint(() => {
      cancelViewChange = undefined
      if (pageActive.value && (value === 'edit' || (!saving.value && unresolvedImageUploadCount.value === 0))) setView(value)
      else requestedView.value = viewMode.value
    })
  },
})
const saving = ref(false)
const activePropertyPatch = ref<RequirementPropertyPatch>({})
const metaSaving = computed(() => Object.keys(activePropertyPatch.value).length > 0)
const formError = ref('')
const imageUploadState = ref<ImageUploadState>({ uploading: 0, failed: 0 })
const pendingStatusId = ref('')
const draftAssigneeIds = ref<string[]>([])
const pendingPropertyPatch = ref<RequirementPropertyPatch>({})
const draftPriority = ref<'low' | 'medium' | 'high'>('medium')
const baseRevisionId = ref('')
const targetRevisionId = ref(routeQueryString(route.query.revision))
const adjacentVersions = ref(true)
const draftTargetId = 'draft_current'
const imageUploadingSaveError = '请等待图片上传完成后再保存版本'
const imageUploadFailedSaveError = '请重试或移除上传失败的图片后再保存版本'
const priorityOptions: BingSelectOption[] = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

const requirementPageTitle = computed(() => {
  const identity = [requirement.value?.key, title.value.trim() || requirement.value?.title]
    .filter(Boolean)
    .join(' · ') || '文档详情'
  const viewLabel = viewMode.value === 'diff' ? 'Diff' : ''

  return [viewLabel, identity, '文档看板'].filter(Boolean).join(' · ')
})

useHead({ title: requirementPageTitle })

/** 当前类型的全部状态，可直接切换到任意一个；当前状态单独标记。 */
const statusOptions = computed(() => documentStates(documentType.value).flatMap(code => {
  const status = meta.value?.statuses.find(item => item.code === code)
  return status ? [{ statusId: status.id, statusName: status.name, color: status.color, current: status.id === requirement.value?.statusId }] : []
}))
const assignmentUsers = computed(() => [...(meta.value?.users ?? []), ...(requirement.value?.assignees ?? []).filter(user => !meta.value?.users.some(item => item.id === user.id))])

const savedRevisionOptions = computed<BingSelectOption[]>(() =>
  (revisions.value ?? []).map((revision) => ({
    label: formatRevision(revision),
    value: revision.id,
    detail: `版本说明（Commit）：${revision.changeNote.trim() || '未填写版本说明'}`,
    meta: {
      保存时间: formatRevisionDate(revision.createdAt),
      保存人: revision.author.name,
      本版编辑人: formatRevisionEditors(revision),
    },
  })),
)

const currentDraftLabel = computed(() => `当前草稿 · ${draft.status.value.replace(/^草稿/, '')}`)
const targetRevisionOptions = computed<BingSelectOption[]>(() => [
  {
    label: currentDraftLabel.value,
    value: draftTargetId,
    detail: '尚未保存为正式版本，暂无提交信息。',
  },
  ...savedRevisionOptions.value.map(option => ({
    ...option,
    disabled: adjacentVersions.value && option.value === oldestRevisionId.value,
  })),
])
const oldestRevisionId = computed(() => [...(revisions.value ?? [])].sort((a, b) => a.version - b.version)[0]?.id)

function alignComparison(changed: 'base' | 'target') {
  const selection = resolveComparisonSelection(revisions.value ?? [], {
    baseId: baseRevisionId.value, targetId: targetRevisionId.value,
  }, changed, adjacentVersions.value, draftTargetId)
  baseRevisionId.value = selection.baseId
  targetRevisionId.value = selection.targetId
}
watch(adjacentVersions, () => alignComparison('base'))

function selectString(value: BingSelectModelValue) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

const selectedPriority = computed({
  get: () => draftPriority.value,
  set: (value: BingSelectModelValue) => {
    if (value === 'low' || value === 'medium' || value === 'high') {
      draftPriority.value = value
    }
  },
})

const selectedBaseRevisionId = computed({
  get: () => baseRevisionId.value,
  set: (value: BingSelectModelValue) => {
    baseRevisionId.value = selectString(value)
    alignComparison('base')
  },
})

const selectedTargetRevisionId = computed({
  get: () => targetRevisionId.value,
  set: (value: BingSelectModelValue) => {
    targetRevisionId.value = selectString(value)
    alignComparison('target')
  },
})

watch(
  requirement,
  (next) => {
    if (!next) return
    if (initializedRequirementId !== next.id) {
      initializedRequirementId = next.id
      content.value = next.currentRevision?.contentJson
        ? ensureBlockIds(cloneRichTextDocument(next.currentRevision.contentJson))
        : createEmptyDocument()
      editingBaseRevisionId.value = next.currentRevision?.id ?? ''
    }
    title.value = next.title
    if (pendingPropertyPatch.value.assigneeIds === undefined) draftAssigneeIds.value = documentAssigneeIds(next)
    if (pendingPropertyPatch.value.priority === undefined) draftPriority.value = next.priority
  },
  { immediate: true },
)

const draft = useRequirementCollaboration({ requirementId: requirementId.value, userId: meta.value?.currentUserId ?? '',
  active: documentActive,
  saving: computed(() => saving.value || titleSaving.value),
  title, content, changeNote, baseRevisionId: editingBaseRevisionId,
  user: { id: meta.value?.currentUserId ?? '', name: meta.value?.users.find(user => user.id === meta.value?.currentUserId)?.name ?? '当前用户',
    color: meta.value?.users.find(user => user.id === meta.value?.currentUserId)?.avatarColor ?? '#2b6ef3' },
  canManageLocks: accountAccess.value?.user.role === 'admin',
  onRevision: message => { if (!message.mutationId || !ownMutations.has(message.mutationId)) void refreshQueue.request(['detail', 'revisions', 'index']) },
  onProperties: message => { if (!message.mutationId || !ownMutations.has(message.mutationId)) void refreshQueue.request(['detail', 'related', 'index']) },
})
const restoringDocument = computed(() => pageResuming.value ? !pageResumeError.value : draft.restoring.value)
const documentLoadError = computed(() => !draft.ready.value && !restoringDocument.value && !pageResumeError.value
  ? draft.recoveryError.value || draft.cloudError.value || '文档暂时无法加载，请重试。' : '')
const annotationDraft = ref<AiAnnotation | null>(null)
const chapterNavigation = useRequirementChapterLink({
  requirementId: requirementId.value,
  routeId: () => String(route.params.id), block: () => route.query.block,
  active: () => pageActive.value,
  ready: () => documentActive.value && draft.ready.value,
  editor: () => editorInstance.value,
  showBody: () => { setView('edit') },
  missing: async () => {
    toast.info({ id: 'chapter-missing', message: '该章节已不存在', position: 'top-center' })
    const query = { ...route.query }
    delete query.block
    if (['diff', 'history'].includes(routeQueryString(query.view))) delete query.view
    await router.replace({ query })
  },
})
const annotations = useRequirementAnnotations({
  active: documentActive,
  userId: computed(() => meta.value?.currentUserId ?? ''), requirementId,
  key: computed(() => requirement.value?.key ?? ''), title, content, flush: () => draft.flushEdits(),
  canCopy: () => draft.ready.value && draft.connection.value === 'connected' && !draft.epochConflict.value && !draft.agentLock.value,
  hasPendingEdits: () => Boolean(draft.pendingEdits.value),
  editingId: computed(() => annotationDraft.value?.id ?? ''),
  fetchCompletions: (annotations, signal) => $fetch<{ completed: AnnotationCompletion[] }>(`/api/requirements/${requirementId.value}/annotation-completions`,
    { method: 'POST', body: { annotations }, signal, retry: 0, timeout: 15_000 }),
  acknowledgeCompletions: annotations => $fetch<{ acknowledged: boolean }>(`/api/requirements/${requirementId.value}/annotation-completions/ack`,
    { method: 'POST', body: { annotations }, keepalive: true, retry: 0, timeout: 15_000 }),
  onCompleted: count => toast.success({ id: 'annotations-completed', title: 'AI 标注已处理', message: `已自动清除 ${count} 条已完成的标注。`, position: 'bottom-right' }),
})
function copyAnnotationsShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || viewMode.value !== 'edit'
    || !event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey
    || (event.code !== 'Digit2' && event.key !== '2') || annotationDraft.value) return
  const dialog = event.target instanceof Element ? event.target.closest('[role="dialog"][aria-modal="true"]') : null
  if (dialog && !dialog.querySelector('.document-panel--drawer')) return
  // 在编辑器收到按键前消费此组合键，避免触发 Tiptap 的二级标题快捷键。
  event.preventDefault()
  event.stopPropagation()
  if (event.repeat || annotations.busy.value || !annotations.notes.value.length) return
  panelTab.value = 'annotations'
  attributesOpen.value = true
  void annotations.exportRequest(true)
}
useActiveVisualEffect(() => documentActive.value, () => {
  document.addEventListener('keydown', copyAnnotationsShortcut, true)
  return () => document.removeEventListener('keydown', copyAnnotationsShortcut, true)
})
watch(annotations.copied, copied => {
  if (copied) toast.success({ id: 'annotations-copied', message: 'AI 标注已复制', position: 'top-center' })
})
watch([draft.editEpoch, draft.connection, draft.agentLock], () => { void annotations.refreshCompletions() })
watch(annotations.storageError, message => {
  if (message) toast.error({ id: `annotation-storage:${requirementId.value}`, title: 'AI 标注存储提示', message, position: 'bottom-right' })
})
const annotationComment = ref(''), annotationError = ref('')
function editAnnotation(note: AiAnnotation) {
  annotationDraft.value = note
  annotationComment.value = note.comment
  annotationError.value = ''
}
function saveAnnotation() {
  if (!annotationDraft.value) return
  try {
    annotations.upsert({ ...annotationDraft.value, comment: annotationComment.value.trim() })
    annotationDraft.value = null
    // 关闭侧栏时保持正文宽度；标注的创建与编号不会改变正文排版。
    if (attributesOpen.value) panelTab.value = 'annotations'
  } catch (error) { annotationError.value = error instanceof Error ? error.message : '保存标注失败。' }
}
async function selectAnnotation(id: string) {
  annotationDraft.value = null
  annotations.activeId.value = id
  if (attributesOpen.value) panelTab.value = 'annotations'
  if (compactViewport.value) await auxiliaryPanel.value?.close()
  await nextTick()
  return editorInstance.value?.scrollToAnnotation(id)
}
async function openAnnotation(note: AiAnnotation) {
  if (await selectAnnotation(note.id)) editAnnotation(note)
}
function selectAnnotationPin(id: string) {
  const note = annotations.notes.value.find(note => note.id === id)
  if (note) void openAnnotation(note)
}
function removeAnnotation(id: string) {
  if (annotationDraft.value?.id === id) annotationDraft.value = null
  annotations.remove(id)
}
function clearAnnotations() {
  annotationDraft.value = null
  annotationComment.value = ''; annotationError.value = ''
  annotations.clear()
}
watch(viewMode, () => { annotationDraft.value = null })
watch([pageActive, draft.navigationPending, draft.navigationError], () => {
  if (!pageActive.value) return
  workspace.value = { id: requirementId.value, locked: draft.navigationPending.value, error: draft.navigationError.value }
}, { immediate: true, flush: 'sync' })
watch(title, value => { if (draft.ready.value) index.setTitle(requirementId.value, value) })
let visited = false
watch(draft.ready, value => {
  if (!value || !requirement.value || visited) return
  visited = true
  recent.visit(requirementId.value)
  index.setTitle(requirementId.value, title.value)
})
onBeforeUnmount(() => { if (workspace.value.id === requirementId.value) workspace.value = { id: '', locked: false, error: '' } })
onDeactivated(() => {
  // 返回时只恢复当前视图布局；其他视图显式打开后才重新参与本次页面布局。
  // 同一次激活中的正文/比较热切换仍保持双方尺寸。
  laidOutViews.value = new Set([viewMode.value])
  activationSequence++
  activationRequest?.abort()
  pageActive.value = false
  revisionDocuments.cancel()
  annotationDraft.value = null
  drawerOpen.value = propertyDialogOpen.value = collaboratorsOpen.value = saveDialogOpen.value = templateDialogOpen.value = false
  agentPanelOpen.value = feedbackOpen.value = false
  if (workspace.value.id === requirementId.value) workspace.value = { id: '', locked: false, error: '' }
  toast.close(feedbackToastId)
})
async function reactivatePage() {
  const timing = detailReturnTiming(requirementId.value)
  timing?.point('activated')
  const endActivation = timing?.start('activation-checks')
  const sequence = ++activationSequence
  activationRequest?.abort()
  const controller = activationRequest = new AbortController()
  pageResuming.value = true
  pageActive.value = true
  pageResumeError.value = ''
  try {
    // 路由中间件已重查账号权限；详情与协作授权响应并行读取，二者通过前保持只读。
    draft.prepareResume(controller.signal)
    const endDetail = timing?.start('detail-fetch')
    const cachedRevision = requirement.value?.currentRevision
    const response = await requestFetch<RequirementDetailResponse>(`/api/requirements/${requirementId.value}`, {
      query: cachedRevision ? { knownRevisionId: cachedRevision.id } : undefined,
      retry: 0, timeout: 15_000, signal: controller.signal,
    }).finally(() => endDetail?.())
    if (!pageActive.value || sequence !== activationSequence) return
    let current: RequirementDto
    if ('currentRevisionUnchanged' in response) {
      if (!cachedRevision || cachedRevision.id !== response.currentRevisionId) throw new Error('版本缓存已失效，请重新读取文档')
      current = { ...response, currentRevision: cachedRevision }
    } else current = response
    requirement.value = current
    draft.navigationPending.value = false
    draft.navigationError.value = ''
    pageResuming.value = false
    recent.visit(requirementId.value)
    // 列表和关联信息使用既有 loading/error/retry，不阻塞协作恢复；离页取消本轮请求。
    const endAuxiliary = timing?.start('auxiliary-fetch')
    void Promise.allSettled([
      refreshRevisions({ signal: controller.signal }), refreshRelatedDocuments({ signal: controller.signal }),
    ]).finally(() => endAuxiliary?.())
  } catch (error) {
    if (!pageActive.value || sequence !== activationSequence) return
    controller.abort()
    const status = (error as { statusCode?: number }).statusCode
    if (status === 403 || status === 404) {
      const backedUp = await draft.persistLocal()
      if (!pageActive.value || sequence !== activationSequence) return
      if (backedUp || !draft.needsBackup.value) {
        index.invalidate()
        await navigateTo('/requirements', { replace: true })
        detailCacheEpoch.value++
        return
      }
    }
    pageResumeError.value = `重新读取文档失败：${draftError(error)}`
  } finally {
    endActivation?.()
  }
}
onActivated(() => { if (!pageActive.value) void reactivatePage() })
onBeforeUnmount(() => { activationSequence++; activationRequest?.abort(); pageActive.value = false })
watch(
  revisions,
  () => alignComparison('target'),
  { immediate: true },
)

const latestRevisionId = computed(() => {
  const candidates = [...(revisions.value ?? []), ...(requirement.value?.currentRevision ? [requirement.value.currentRevision] : [])]
  return candidates.reduce<RevisionMetadata | null>((latest, revision) => !latest || revision.version > latest.version ? revision : latest, null)?.id ?? ''
})
watch(latestRevisionId, id => { if (id) void revisionDocuments.load([id]) }, { immediate: true })
const latestSavedRevision = computed(() => requirement.value?.currentRevision?.id === latestRevisionId.value
  ? requirement.value.currentRevision : revisionDocuments.get(latestRevisionId.value))
const versionMarkersEnabled = computed(() => appPreferences.preferences.value.editor.versionMarkers)
const { modified: contentModified, comparison: contentComparison, markers: versionMarkers } = useContentModified(content,
  computed(() => latestSavedRevision.value?.contentJson ?? null),
  computed(() => draft.ready.value && (!latestRevisionId.value || Boolean(latestSavedRevision.value))),
  { active: () => documentActive.value && viewMode.value === 'edit', markers: () => versionMarkersEnabled.value })
const comparisonFocus = shallowRef<{ blockId: string; request: number } | null>(null)
function compareVersionChange(marker: VersionMarker) {
  if (!latestSavedRevision.value || unresolvedImageUploadCount.value) return
  baseRevisionId.value = latestSavedRevision.value.id
  targetRevisionId.value = draftTargetId
  comparisonFocus.value = { blockId: marker.pairs[0]!.id, request: (comparisonFocus.value?.request ?? 0) + 1 }
  setView('diff')
}
watch(draft.agentLock, lock => { if (!lock) agentPanelOpen.value = false })
const comparisonIds = computed(() => [baseRevisionId.value, targetRevisionId.value === draftTargetId ? '' : targetRevisionId.value].filter(Boolean))
watch([documentActive, viewMode, comparisonIds], () => { if (documentActive.value && viewMode.value === 'diff') void revisionDocuments.load(comparisonIds.value) }, { immediate: true })
const comparisonError = computed(() => revisionsError.value ? '版本列表加载失败，请重试。' : revisionDocuments.error(comparisonIds.value))
const baseRevision = computed(() => revisionDocuments.get(baseRevisionId.value))
const targetRevision = computed(() => revisionDocuments.get(targetRevisionId.value))
async function retryComparison() {
  if (revisionsError.value) await refreshRevisions()
  await revisionDocuments.load(comparisonIds.value)
}
const currentUserName = computed(
  () => meta.value?.users.find((user) => user.id === meta.value?.currentUserId)?.name ?? '当前用户',
)
const targetDocument = computed(() => {
  if (targetRevisionId.value === draftTargetId) return content.value
  return targetRevision.value?.contentJson ?? null
})
const baseRevisionLabel = computed(() => (baseRevision.value ? formatRevision(baseRevision.value) : '基准版本'))
const targetRevisionLabel = computed(() =>
  targetRevisionId.value === draftTargetId
    ? currentDraftLabel.value
    : targetRevision.value
      ? formatRevision(targetRevision.value)
      : '对比目标',
)
const unresolvedImageUploadCount = computed(
  () => imageUploadState.value.uploading + imageUploadState.value.failed,
)
const versionRestoreDisabledReason = computed(() => {
  if (draft.agentLock.value) return 'AI 正在编辑，暂时无法恢复。'
  if (draft.readOnly.value) return '当前文档为只读。'
  if (unresolvedImageUploadCount.value) return '请先完成图片上传，或处理失败的图片。'
  if (saving.value || draft.busy.value || draft.navigationPending.value) return '当前操作完成后可以恢复。'
  return ''
})
const saveDisabled = computed(() => unresolvedImageUploadCount.value > 0 || draft.busy.value || draft.navigationPending.value || !draft.ready.value || draft.readOnly.value)
const saveButtonLabel = computed(() => {
  if (draft.agentLock.value) return 'AI 编辑中 · 只读'
  if (imageUploadState.value.uploading) {
    return `图片上传中（${imageUploadState.value.uploading}）`
  }
  if (imageUploadState.value.failed) return '请处理上传失败的图片'
  return '保存版本'
})

const workspaceNotices = computed<WorkspaceNotice[]>(() => {
  const notices: WorkspaceNotice[] = []
  if (draft.epochConflict.value) notices.push({ id: 'recovery', tone: 'error', title: '有待恢复的本机修改',
    message: draft.cloudError.value || '尚未同步的本机修改已保留副本。导出后载入当前草稿，再核对需要补回的内容。', action: '导出本机副本并载入最新内容' })
  if (draft.navigationError.value) notices.push({ id: 'navigation', tone: 'error', title: '切换文档失败', message: draft.navigationError.value })
  if (formError.value && !saveDialogOpen.value) notices.push({ id: 'editor', tone: 'error', title: '操作未完成', message: formError.value, action: '重新打开保存版本', dismissible: true })
  if (unresolvedImageUploadCount.value) notices.push({ id: 'upload', tone: imageUploadState.value.failed ? 'error' : 'info', title: '图片上传',
    message: imageUploadState.value.failed ? '有图片上传失败，请在正文中重试或移除后再保存。' : '图片正在上传，完成后可保存正式版本。' })
  return notices
})
const inlineFeedback = computed(() => showAttributes.value && panelTab.value === 'properties')
watch([inlineFeedback, workspaceNotices], ([inline, notices]) => { if (inline || !notices.length) feedbackOpen.value = false })
const feedbackToastId = `requirement-feedback-${requirementId.value}`
watch(() => workspaceNotices.value.filter(notice => notice.tone === 'error' && notice.id !== 'editor').map(notice => notice.message).join('\n'), message => {
  if (message && !inlineFeedback.value) toast.error({ id: feedbackToastId, title: '工作区有待处理的提示', message, position: 'bottom-right' })
  else toast.close(feedbackToastId)
})
onBeforeUnmount(() => toast.close(feedbackToastId))

function handleNoticeAction(id: string) {
  if (id === 'recovery') void draft.exportRecoveryAndReload()
  if (id === 'editor') saveDialogOpen.value = true
}
function dismissNotice(id: string) {
  if (id === 'editor') formError.value = ''
}
async function cancelAgentEdit() {
  if (!draft.agentLock.value || !draft.canReleaseLock.value || draft.releasingLock.value) return
  const operation = feedback.begin(`正在取消 ${requirement.value?.key} 的 AI 编辑`)
  agentPanelOpen.value = false
  try {
    await draft.releaseLock()
    if (draft.lockError.value || draft.agentLock.value) operation.error(`取消 AI 编辑未完成：${draft.lockError.value || '锁仍然有效，请重试。'}`)
    else operation.success(`${requirement.value?.key} 的 AI 编辑已取消`)
  } catch (cause) { operation.error(`取消 AI 编辑失败：${draftError(cause)}`) }
}

async function saveRevision() {
  if (saving.value || draft.busy.value || draft.navigationPending.value || !draft.ready.value || draft.readOnly.value) return
  if (titleInput.value && !titleInput.value.validate()) { formError.value = '请先填写有效的文档标题，再保存版本。'; return }
  if (unresolvedImageUploadCount.value) {
    formError.value = imageUploadState.value.uploading
      ? imageUploadingSaveError
      : imageUploadFailedSaveError
    return
  }
  if (!title.value.trim()) {
    formError.value = '文档标题不能为空'
    return
  }

  saving.value = true
  formError.value = ''
  saveDialogOpen.value = false
  const key = requirement.value?.key ?? '文档'
  const note = changeNote.value
  const operation = feedback.begin(`正在保存 ${key} 的正式版本`)
  let written = false
  try {
    if (!versionSaveRequest) {
      if (titleInput.value && !await titleInput.value.commit(true)) throw new Error('标题尚未保存，请处理标题错误后重试')
      const prepared = await draft.prepareVersion()
      if (!operation.isCurrent()) return
      versionSaveRequest = { id: nanoid(24), prepared, body: {
        contentJson: prepared.snapshot.contentJson, changeNote: note, draftId: prepared.draftId,
        collaborationUpdate: draft.collaborationUpdate(), editEpoch: draft.editEpoch.value, schemaVersion: 3, schemaCapabilities: DOCUMENT_NODE_CAPABILITIES,
      } }
    }
    const request = versionSaveRequest
    const prepared = request.prepared
    const created = await $fetch<RevisionDto>(`/api/requirements/${requirementId.value}/revisions`, {
      method: 'POST',
      body: { ...request.body, clientSaveId: trackMutation(request.id) },
      retry: 0,
      timeout: 15_000,
    })
    written = true
    versionSaveRequest = null
    operation.success(`${key} 已保存版本 v${created.version}`)
    if (!operation.isCurrent()) return
    revisionDocuments.prime(created)
    if (requirement.value && (!requirement.value.currentRevision || requirement.value.currentRevision.version <= created.version)) requirement.value = { ...requirement.value, currentRevision: created }
    index.invalidate()
    await draft.versionSaved(prepared.draftId, { baseRevisionId: created.id, title: created.title,
      contentJson: ensureBlockIds(cloneRichTextDocument(created.contentJson)), changeNote: '', pendingUploads: [] }, prepared.snapshot.changeNote)
    baseRevisionId.value = created.id
    targetRevisionId.value = draftTargetId
    void operation.refresh(() => refreshRevisions(), () => revisionsError.value)
  } catch (error) {
    if (written) {
      formError.value = '版本已保存，个人备份收尾未完成，请检查草稿同步提示。'
      operation.warning(`${key} 的版本已保存，个人备份收尾未完成。`)
    } else {
      const status = (error as { statusCode?: number }).statusCode
      if (status && status >= 400 && status < 500 && status !== 408) versionSaveRequest = null
      formError.value = `${draftError(error)}，版本说明已保留，可重新打开保存版本重试。`
      operation.error(`${key} 保存版本未完成：${draftError(error)}，重试会核对同一次保存。`)
    }
  } finally {
    saving.value = false
  }
}

async function changeStatus(option: { statusId: string; current: boolean }) {
  if (pendingStatusId.value || option.current) return
  pendingStatusId.value = option.statusId
  try { await persistProperties({ statusId: option.statusId }) }
  catch { /* 属性栏保留失败选择及重试入口。 */ }
  finally { pendingStatusId.value = '' }
}

async function patchRequirement(field?: 'assigneeIds' | 'priority') {
  const patch = field === 'assigneeIds' ? { assigneeIds: [...draftAssigneeIds.value] } : field === 'priority' ? { priority: draftPriority.value } : pendingPropertyPatch.value
  try { await persistProperties(patch) }
  catch { /* 失败值由队列保留，后续输入不会被旧响应覆盖。 */ }
}

const propertyFeedback = new Map<keyof RequirementPropertyPatch, ReturnType<typeof feedback.begin>>()
const propertyKeys = (patch: RequirementPropertyPatch) => Object.keys(patch) as (keyof RequirementPropertyPatch)[]
const propertyFeedbackIsCurrent = () => propertyFeedback.size > 0 && [...propertyFeedback.values()].every(operation => operation.isCurrent())
function propertySummary(patch: RequirementPropertyPatch) {
  return [
    patch.assigneeIds !== undefined ? `负责人：${patch.assigneeIds.map(id => assignmentUsers.value.find(user => user.id === id)?.name ?? id).join('、') || '未分配'}` : '',
    patch.priority !== undefined ? `优先级：${priorityOptions.find(option => option.value === patch.priority)?.label}` : '',
    patch.statusId !== undefined ? `状态：${meta.value?.statuses.find(status => status.id === patch.statusId)?.name ?? patch.statusId}` : '',
  ].filter(Boolean).join('；')
}
const propertyQueue = createLatestPatchQueue<RequirementPropertyPatch, RequirementDto>({
  send: patch => {
    if (!propertyFeedbackIsCurrent()) return Promise.reject(new Error('账号已切换，本次修改未提交'))
    propertyWriteSequence++
    return $fetch<RequirementDto>(`/api/requirements/${requirementId.value}`, {
      method: 'PATCH', body: { ...patch, mutationId: trackMutation() }, retry: 0, timeout: 15_000,
    })
  },
  confirmed: (updated, patch) => {
    if (!requirement.value || !propertyFeedbackIsCurrent()) return
    propertyWriteSequence++
    // 只合并本次保存的字段，避免交错返回的标题与属性请求覆盖对方的新结果。
    requirement.value = { ...requirement.value,
      ...(patch.assigneeIds !== undefined ? { assigneeIds: updated.assigneeIds, assignees: updated.assignees } : {}),
      ...(patch.priority !== undefined ? { priority: updated.priority } : {}),
      ...(patch.statusId !== undefined ? { statusId: updated.statusId, status: updated.status } : {}),
    }
    index.invalidate()
  },
  settled: patch => {
    for (const field of propertyKeys(patch)) {
      propertyFeedback.get(field)?.success(`${requirement.value?.key} 的属性已更新，${propertySummary({ [field]: patch[field] })}`)
      propertyFeedback.delete(field)
    }
  },
  failed: (cause, pending) => {
    const remaining = propertyKeys(pending).map(field => ({ assigneeIds: '负责人', priority: '优先级', statusId: '状态' })[field]).join('、')
    metaError.value = `${draftError(cause)}，${remaining}的当前选择尚未生效，可重试或取消修改。`
    for (const field of propertyKeys(pending)) {
      propertyFeedback.get(field)?.error(`${requirement.value?.key} 属性更新失败，${propertySummary({ [field]: pending[field] })}：${draftError(cause)}，可重试或取消修改。`)
      propertyFeedback.delete(field)
    }
  },
  changed: (pending, active) => {
    pendingPropertyPatch.value = pending; activePropertyPatch.value = active
    if (!requirement.value) return
    if (pending.assigneeIds === undefined) draftAssigneeIds.value = documentAssigneeIds(requirement.value)
    if (pending.priority === undefined) draftPriority.value = requirement.value.priority
  },
})
function cancelPropertyChanges() { propertyQueue.cancel(); metaError.value = '' }
async function persistProperties(patch: RequirementPropertyPatch) {
  if (!requirement.value || draft.navigationPending.value || draft.readOnly.value || viewMode.value !== 'edit') throw new Error('当前文档暂时无法修改属性')
  patch = { ...patch }
  if (patch.assigneeIds !== undefined && pendingPropertyPatch.value.assigneeIds === undefined
    && JSON.stringify([...patch.assigneeIds].sort()) === JSON.stringify([...requirement.value.assigneeIds].sort())) delete patch.assigneeIds
  if (patch.priority === requirement.value.priority && pendingPropertyPatch.value.priority === undefined) delete patch.priority
  if (patch.statusId === requirement.value.statusId && pendingPropertyPatch.value.statusId === undefined) delete patch.statusId
  if (!Object.keys(patch).length) return
  const target = { ...pendingPropertyPatch.value, ...patch }
  const key = requirement.value.key
  for (const field of propertyKeys(target)) {
    const message = `正在更新 ${key}，${propertySummary({ [field]: target[field] })}`
    const operation = propertyFeedback.get(field)
    if (operation) operation.loading(message)
    else propertyFeedback.set(field, feedback.begin(message))
  }
  metaError.value = ''
  await propertyQueue.submit(patch)
}

async function saveTitle(value: string) {
  if (!requirement.value || draft.readOnly.value || draft.navigationPending.value) throw new Error('当前文档暂时无法修改标题')
  const operation = feedback.begin(`正在保存 ${requirement.value.key} 的标题`)
  propertyWriteSequence++
  try {
  const updated = await $fetch<RequirementDto>(`/api/requirements/${requirementId.value}`, {
    method: 'PATCH', body: { title: value, mutationId: trackMutation() }, retry: 0, timeout: 15_000,
  })
  propertyWriteSequence++
  operation.success(`${requirement.value.key} 的标题已保存`)
  if (operation.isCurrent()) { requirement.value = { ...requirement.value, title: updated.title }; index.invalidate() }
  return updated.title
  } catch (cause) { operation.error(`标题保存失败：${draftError(cause)}，输入已保留。`); throw cause }
}

function handleEditorError(message: string) {
  formError.value = message
}

function handleShowSelectionHistory(anchor: SelectionHistoryAnchor) {
  if (!import.meta.client) return

  const token = createSelectionHistoryContextToken()
  try {
    writeSelectionHistoryTabContext(window.localStorage, token, {
      requirementId: requirementId.value,
      anchor,
      draftDocument: cloneRichTextDocument(content.value),
      currentUserName: currentUserName.value,
      capturedAt: new Date().toISOString(),
      attribution: draft.attributionSnapshot(),
      attributionPending: draft.pendingEdits.value > 0,
    })

    const path = `/selection-history/${encodeURIComponent(requirementId.value)}?context=${encodeURIComponent(token)}`
    const opened = window.open(path, '_blank')
    if (!opened) {
      removeSelectionHistoryTabContext(window.localStorage, null, token)
      formError.value = '浏览器阻止了新标签页，请允许此站点打开弹出式窗口后重试'
      return
    }

    try {
      opened.opener = null
    } catch {
      // 部分浏览器不允许修改 opener；不影响同源页面读取一次性上下文。
    }
    formError.value = ''
  } catch {
    removeSelectionHistoryTabContext(window.localStorage, null, token)
    formError.value = '无法创建选区历史标签页，请检查浏览器存储空间后重试'
  }
}

function handleImageUploadState(state: ImageUploadState) {
  imageUploadState.value = state
  if (
    !state.uploading
    && !state.failed
    && (formError.value === imageUploadingSaveError || formError.value === imageUploadFailedSaveError)
  ) {
    formError.value = ''
  }
}

function handleRevertDraftChange(payload: RevertChangePayload) {
  if (targetRevisionId.value !== draftTargetId || !baseRevision.value || draft.readOnly.value) return

  const result = revertDraftChange(content.value, baseRevision.value.contentJson, payload)
  if (!result.changed) {
    formError.value = '未找到可回退的草稿内容，请刷新后再试'
    return
  }

  content.value = result.document
  formError.value = ''
  toast?.success?.({
    title: '已回退此更改',
    message: '当前草稿已恢复为所选旧版本的内容',
    position: 'bottom-right',
  })
}

function formatRevision(revision: RevisionMetadata) {
  const time = new Date(revision.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' })
  return `v${revision.version} · ${time}`
}

function formatRevisionEditors(revision: RevisionSummaryDto) {
  if (!revision.editors.length) return '未记录'
  return [...revision.editors.map(author => author.name), ...(revision.editorsIncomplete ? ['部分编辑人未记录'] : [])].join('、')
}

function formatRevisionDate(createdAt: string) {
  return new Date(createdAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

function routeQueryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}
</script>

<template>
  <main ref="pageRoot" class="requirement-page" :class="{ 'requirement-page--wide': !showAttributes || compactViewport, 'requirement-page--reading': viewMode !== 'edit', 'requirement-page--locked': Boolean(draft.agentLock.value) }">
    <div v-if="pageResumeError" class="workspace-notice" role="alert">
      <span>{{ pageResumeError }}</span>
      <BingButton size="sm" :throttle="false" @click="reactivatePage">重新读取文档</BingButton>
    </div>
    <header class="requirement-topbar">
      <RequirementWorkspaceNav v-model="selectedView" :requirement-key="requirement?.key ?? '文档'" :items="workspaceTabs" compact />
      <section class="requirement-propertybar" :class="{ 'requirement-propertybar--compact': compactProperties }" aria-label="文档常用属性" :aria-busy="metaSaving">
        <template v-if="!compactProperties">
          <BingDropDown trigger="click" aria-label="选择文档状态">
            <template #trigger="{ triggerProps }"><BingButton v-bind="triggerProps" variant="secondary" size="sm" :disabled="statusOptions.length < 2 || !!pendingStatusId || !!activePropertyPatch.statusId || draft.navigationPending.value || viewMode !== 'edit' || draft.readOnly.value" aria-label="修改文档状态"><span class="document-status__current" role="status" aria-label="当前状态"><i :style="{ backgroundColor: requirement?.status.color }" aria-hidden="true" />{{ requirement?.status.name }}</span><BingIcon :icon="ChevronDown" :size="14" decorative /></BingButton></template>
            <BingDropDownItem v-for="option in statusOptions" :key="option.statusId" :title="option.statusName" :aria-label="option.current ? `${option.statusName}（当前状态）` : option.statusName" :description="option.current ? '当前状态' : undefined" type="radio" :checked="option.current" :close-on-click="!option.current" @click="changeStatus(option)" />
          </BingDropDown>
          <DocumentAssignees v-model="draftAssigneeIds" class="requirement-propertybar__select requirement-propertybar__owners" :users="assignmentUsers" compact :disabled="draft.navigationPending.value || viewMode !== 'edit' || draft.readOnly.value" @change="patchRequirement('assigneeIds')" />
          <BingSelect v-model="selectedPriority" class="requirement-propertybar__select" :options="priorityOptions" :disabled="draft.navigationPending.value || viewMode !== 'edit' || draft.readOnly.value" :clearable="false" :searchable="false" :min-width="0" :width="140" block aria-label="优先级" @change="patchRequirement('priority')">
            <template #value="{ selectedOptions }"><span class="requirement-propertybar__priority-value"><BingIcon :icon="Flag" :size="15" decorative />{{ selectedOptions[0]?.label }}优先级</span></template>
          </BingSelect>
        </template>
        <BingButton v-else size="sm" variant="secondary" aria-label="文档属性" :title="`${requirement?.status.name ?? ''} · ${requirement?.assignees.map(user => user.name).join('、') || '未分配'} · ${priorityOptions.find(option => option.value === requirement?.priority)?.label ?? ''}优先级`" :disabled="viewMode !== 'edit' || draft.navigationPending.value || draft.readOnly.value" @click="propertyDialogOpen = true"><BingIcon :icon="SlidersHorizontal" :size="16" decorative /><span class="requirement-propertybar__label">文档属性</span></BingButton>
      </section>
      <div class="requirement-topbar__actions">
        <BingButton class="requirement-collaborators-trigger" variant="ghost" size="sm" :throttle="false" aria-label="查看共同编辑成员" :title="`${draft.participants.value.length} 人正在编辑`" @click="collaboratorsOpen = true">
          <span v-if="draft.participants.value.length" class="requirement-collaborators-avatars" aria-hidden="true"><span v-for="member in draft.participants.value.slice(0, 3)" :key="member.id" class="requirement-collaborators-avatar" :style="{ '--collaborator-color': member.color }">{{ Array.from(member.name.trim())[0]?.toLocaleUpperCase() || '?' }}</span><span v-if="draft.participants.value.length > 3" class="requirement-collaborators-overflow">+{{ draft.participants.value.length - 3 }}</span></span>
          <BingIcon v-else :icon="Users" :size="17" decorative />
        </BingButton>
        <RequirementSaveActions :modified="contentModified" :draft="draft" :label="saveButtonLabel" :saving="saving" :disabled="saveDisabled" toolbar @save="saveDialogOpen = true" />
        <BingDropDown trigger="click" placement="bottom-end" aria-label="更多文档操作">
          <template #trigger="{ triggerProps }"><BingButton v-bind="triggerProps" variant="ghost" size="sm" aria-label="更多文档操作"><BingIcon :icon="Ellipsis" :size="18" decorative /></BingButton></template>
          <BingDropDownItem title="另存为模板" :disabled="viewMode !== 'edit' || !draft.ready.value || draft.readOnly.value || saving || unresolvedImageUploadCount > 0" @click="templateDialogOpen = true" />
          <BingDropDownItem title="属性变更记录" :href="`/requirements/${requirementId}/property-history`" />
          <BingDropDownItem :title="`工作区提示 · ${workspaceNotices.length}`" aria-label="打开工作区提示" :disabled="!workspaceNotices.length" @click="feedbackOpen = true" />
          <BingDropDownItem v-if="draft.agentLock.value" title="AI 编辑状态" aria-label="打开 AI 编辑状态" @click="agentPanelOpen = true" />
        </BingDropDown>
        <BingButton v-if="viewMode === 'edit'" class="requirement-panel-toggle" variant="ghost" size="sm" :aria-expanded="showAttributes" :throttle="false" :aria-label="showAttributes ? '收起文档辅助面板' : '打开文档信息和目录'" @click="attributesOpen = !attributesOpen"><BingIcon :icon="PanelRightOpen" :size="18" decorative /></BingButton>
      </div>
    </header>
    <div v-if="metaError" class="requirement-property-feedback">
      <div v-if="metaError" class="requirement-meta-error" role="alert"><span>{{ metaError }}</span><BingButton size="sm" variant="ghost" :loading="metaSaving" :disabled="draft.readOnly.value" @click="patchRequirement()">重试保存属性</BingButton><BingButton size="sm" variant="ghost" :disabled="metaSaving" @click="cancelPropertyChanges">取消属性修改</BingButton></div>
    </div>
    <div class="requirement-page__views">
    <BingSplitPane class="requirement-page__workspace" :class="{ 'requirement-view--hidden': viewMode !== 'edit', 'requirement-view--parked': !laidOutViews.has('edit') }"
      :aria-hidden="viewMode !== 'edit'" :inert="viewMode !== 'edit'" :side-size="dockedPanel ? appPreferences.preferences.value.editor.panelWidth : 0"
      :min-side-size="dockedPanel ? 320 : 0" :max-side-size="dockedPanel ? 560 : 0" :min-main-size="600" :default-side-size="360"
      :disabled="!dockedPanel" aria-label="调整文档辅助面板宽度" @update:side-size="appPreferences.setPanelWidth">
      <section class="requirement-main" :aria-busy="restoringDocument" :style="{ '--requirement-loading-inset': `${loadingToolbarHeight}px` }">
        <div v-if="!draft.ready.value" ref="pendingToolbar" class="requirement-editor__toolbar" aria-label="编辑器工具栏">
          <RequirementEditorToolbarControls disabled annotations />
        </div>
        <ClientOnly>
          <RichRequirementEditor
            v-if="draft.ready.value"
            ref="editorInstance"
            :key="draft.editorKey.value"
            :inert="restoringDocument"
            v-model="content"
            :requirement-id="requirementId"
            :chapter-navigation-pending="chapterNavigation.pending.value"
            :disabled="saving || draft.busy.value || draft.navigationPending.value || draft.readOnly.value"
            :active="documentActive && viewMode === 'edit'"
            :version-comparison="contentComparison"
            :version-markers="versionMarkersEnabled ? versionMarkers : undefined"
            :version-number="latestSavedRevision?.version"
            :version-pending="contentModified === null"
            :version-read-only="draft.readOnly.value && !draft.agentLock.value"
            :version-restore-disabled-reason="versionRestoreDisabledReason"
            :version-compare-disabled="unresolvedImageUploadCount > 0"
            @compare-version-change="compareVersionChange"
            external-outline
            fill-height
            :outline-active="outlineActive"
            :annotations="annotations.notes.value"
            :active-annotation-id="annotations.activeId.value"
            :annotation-draft="annotationDraft"
            v-model:annotation-comment="annotationComment"
            :annotation-error="annotationError"
            :initial-uploads="draft.uploads.value"
            :collaboration="draft.editorOptions.value"
            :prepare-image-upload="draft.ensureServerDraft"
            @upload-checkpoint="draft.setUploads"
            @error="handleEditorError"
            @image-upload-state="handleImageUploadState"
            @show-selection-history="handleShowSelectionHistory"
            @add-annotation="editAnnotation"
            @select-annotation="selectAnnotationPin"
            @save-annotation="saveAnnotation"
            @cancel-annotation="annotationDraft = null"
            @remove-annotations="ids => ids.forEach(removeAnnotation)"
          >
            <template #heading>
              <div class="requirement-document-byline">
                <span class="requirement-document-type">{{ DOCUMENT_TYPE_LABELS[documentType] }}</span>
                <span v-if="requirement?.reporter">{{ requirement.reporter.name }} 创建</span>
              </div>
              <RequirementTitleInput ref="titleInput" :title="title" :save="saveTitle"
                :disabled="saving || draft.busy.value || draft.navigationPending.value || !draft.ready.value || draft.readOnly.value"
                @busy="titleSaving = $event" />
              <div class="requirement-document-meta">
                <span :class="{ 'requirement-document-version': requirement?.currentRevision }">{{ requirement?.currentRevision ? `正式版本 v${requirement.currentRevision.version}` : '尚未保存正式版本' }}</span>
                <span :class="{ 'requirement-document-modified': contentModified }" role="status" aria-label="版本保存状态">
                  <button v-if="contentModified && versionMarkers.length" class="requirement-version-navigation" type="button" aria-label="定位下一处正文修改" @click="editorInstance?.nextVersionChange()">已修改 · {{ versionMarkers.length }} 处</button>
                  <template v-else>{{ contentModified === null ? '正在核对版本…' : contentModified ? '有未保存为版本的修改' : '与最新版本一致' }}</template>
                </span>
              </div>
            </template>
          </RichRequirementEditor>
        </ClientOnly>
        <div v-if="documentLoadError" class="requirement-document-error" role="alert">
          <p>{{ documentLoadError }}</p>
          <BingButton size="sm" variant="secondary" :throttle="false" :disabled="!draft.canRetry.value" @click="draft.retry()">重新加载文档</BingButton>
        </div>
        <RequirementDocumentLoading :pending="pageActive && viewMode === 'edit' && restoringDocument" />
      </section>
      <template #side>
      <RequirementAuxiliaryPanel ref="auxiliaryPanel" v-model="attributesOpen" v-model:tab="panelTab" :compact="compactViewport">
        <RequirementAnnotations v-if="panelTab === 'annotations'" v-model:overall="annotations.overall.value"
          :notes="annotations.notes.value" :resolutions="annotations.resolutions.value" :active-id="annotations.activeId.value"
          :busy="annotations.busy.value" :copied="annotations.copied.value" :error="annotations.error.value || annotations.completionError.value" :storage-error="annotations.storageError.value" :preview="annotations.preview.value"
          @select="selectAnnotation" @edit="openAnnotation" @remove="removeAnnotation" @clear="clearAnnotations" @copy="annotations.exportRequest(true)" @preview="annotations.exportRequest(false)" @preview-copied="annotations.previewCopied()" @close-preview="annotations.preview.value = ''" @retry="annotations.refreshCompletions()" />
        <RequirementOutline v-else-if="panelTab === 'outline'" class="requirement-outline--auxiliary" embedded
          :items="editorInstance?.outline.items.value ?? []" :active-ids="editorInstance?.outline.activeIds.value ?? []"
          :viewport-height="editorInstance?.viewportHeight ?? 560" :header-height="0" @select="selectHeading" />
        <BingScrollbar v-else class="requirement-properties-scroll" height="100%" aria-label="文档侧栏内容">
          <div class="requirement-side__content">
            <RequirementWorkspaceNotice :notices="workspaceNotices" @action="handleNoticeAction" @dismiss="dismissNotice" />
            <RequirementAgentLockNotice v-if="draft.agentLock.value" :lock="draft.agentLock.value" :can-release="draft.canReleaseLock.value" :busy="draft.releasingLock.value" :error="draft.lockError.value" @release="cancelAgentEdit" />
            <section class="requirement-properties" aria-label="文档信息">
              <dl class="requirement-meta-summary">
                <div><dt>文档类型</dt><dd>{{ DOCUMENT_TYPE_LABELS[documentType] }}</dd></div>
                <div><dt>报告人</dt><dd>{{ requirement?.reporter.name ?? '—' }}</dd></div>
                <div><dt>正式版本</dt><dd>{{ requirement?.currentRevision ? `v${requirement.currentRevision.version}` : '尚未保存' }}</dd></div>
                <div v-if="requirement?.currentRevision"><dt>保存时间</dt><dd>{{ formatRevisionDate(requirement.currentRevision.createdAt) }}</dd></div>
              </dl>

              <NuxtLink class="workspace-text-link" :to="`/requirements/${requirementId}/property-history`">属性变更记录</NuxtLink>
              <RelatedDocuments :requirement-id="requirementId" :title="title" :items="relatedDocuments ?? []" :loading="relatedLoading" :error="Boolean(relatedError)"
                :saving="relatedSaving" :disabled="draft.readOnly.value || draft.navigationPending.value"
                :add-documents="addRelatedDocuments" :remove-document="removeRelatedDocument" @retry="refreshRelatedDocuments()" />
            </section>
          </div>
        </BingScrollbar>
      </RequirementAuxiliaryPanel>
      </template>
    </BingSplitPane>
    <section v-if="hasOpenedDiff" class="requirement-main requirement-page__comparison" :class="{ 'requirement-view--hidden': viewMode !== 'diff', 'requirement-view--parked': !laidOutViews.has('diff') }" :aria-hidden="viewMode !== 'diff'" :inert="viewMode !== 'diff'" :aria-busy="restoringDocument">
        <RichTextDiffViewer
          :inert="restoringDocument"
          :requirement-id="requirementId"
          :focus-change="comparisonFocus"
          :comparison="contentComparison"
          :active="documentActive && viewMode === 'diff'"
          :comparison-key="`${baseRevisionId}:${targetRevisionId}`"
          :cache-scope="`${meta?.currentUserId}:${requirementId}:${draft.editEpoch.value}:${draft.epochConflict.value}`"
          class="rich-diff--document"
          :base="baseRevision?.contentJson ?? null" :target="targetDocument"
          :base-label="baseRevisionLabel" :target-label="targetRevisionLabel"
          fill-height
          :revertible="targetRevisionId === draftTargetId && !saving && !draft.busy.value && !draft.readOnly.value"
          @revert-change="handleRevertDraftChange"
        >
          <template #versions>
            <section class="requirement-compare-panel" aria-label="版本选择">
              <div class="requirement-compare-versions">
                <RequirementRevisionSelect v-model="selectedBaseRevisionId" label="旧版本" display-label="旧版" inline :options="savedRevisionOptions" />
                <BingIcon class="requirement-compare-arrow" :icon="ArrowRight" :size="14" decorative />
                <RequirementRevisionSelect v-model="selectedTargetRevisionId" label="比较目标" display-label="目标" inline :options="targetRevisionOptions" />
              </div>
              <div class="requirement-compare-panel__mode">
                <BingCheckbox v-model="adjacentVersions" size="sm" label="只比较相邻版本" />
                <BingTooltip :content="adjacentVersions ? '更换旧版或目标时，另一侧自动选择相邻版本。' : '自由选择两个版本进行比较。'" placement="bottom" trigger="hover" :interactive="false">
                  <BingButton variant="ghost" size="sm" aria-label="相邻版本比较说明"><BingIcon :icon="Info" :size="14" decorative /></BingButton>
                </BingTooltip>
              </div>
            </section>
          </template>
          <template #placeholder>
            <div class="empty-state" role="status" aria-label="版本加载状态">
              <template v-if="comparisonError">
                <p>{{ comparisonError }}</p><BingButton size="sm" :throttle="false" @click="retryComparison">重试加载版本</BingButton>
              </template>
              <template v-else>{{ comparisonIds.length ? '正在加载版本正文…' : '至少保存一个版本后可以查看差异。' }}</template>
            </div>
          </template>
        </RichTextDiffViewer>
        <RequirementDocumentLoading :pending="pageActive && viewMode === 'diff' && restoringDocument" />
    </section>
    </div>
    <DocumentPropertiesDialog v-if="requirement" v-model="propertyDialogOpen" :status-id="requirement.statusId" :status-name="requirement.status.name" :assignee-ids="requirement.assigneeIds" :priority="requirement.priority"
      :users="assignmentUsers" :status-options="statusOptions" :disabled="viewMode !== 'edit' || draft.readOnly.value || draft.navigationPending.value" :save="persistProperties" />
    <BingDialog v-model="collaboratorsOpen" title="共同编辑成员" :width="380" :show-footer="false" :show-peek="false">
      <RequirementCollaboratorsPanel :participants="draft.participants.value" :current-user-id="meta?.currentUserId ?? ''" :connection="draft.connection.value" />
    </BingDialog>

    <SaveDocumentTemplateDialog v-model="templateDialogOpen" :title="title" :document-type="documentType" :content="content" />
    <BingDialog v-model="feedbackOpen" title="工作区提示" :width="420" :show-footer="false" :show-peek="false">
      <RequirementWorkspaceNotice :notices="workspaceNotices" @action="handleNoticeAction" @dismiss="dismissNotice" />
    </BingDialog>
    <BingDialog v-model="agentPanelOpen" title="AI 编辑状态" :width="380" :show-footer="false" :show-peek="false">
      <RequirementAgentLockNotice v-if="draft.agentLock.value" :lock="draft.agentLock.value" :can-release="draft.canReleaseLock.value" :busy="draft.releasingLock.value" :error="draft.lockError.value" @release="cancelAgentEdit" />
    </BingDialog>

    <BingDialog :busy="saving" v-model="saveDialogOpen" title="保存正式版本" :width="500" :show-peek="false">
      <form :id="saveFormId" class="revision-save-form" @submit.prevent="saveRevision">
        <p>为当前草稿创建历史快照，包含所有成员已经同步的修改。</p>
        <label for="revision-note">版本说明</label>
        <BingTextarea id="revision-note" v-model="changeNote" placeholder="简要记录本次变更（可选）" :rows="4" :max-length="500" block :disabled="saving || draft.busy.value || draft.navigationPending.value || draft.readOnly.value" />
        <small>取消后保留说明，可稍后继续保存。</small>
        <p v-if="formError" class="account-error" role="alert">{{ formError }}</p>
      </form>
      <template #footer>
        <BingButton variant="secondary" :disabled="saving" @click="saveDialogOpen = false">取消</BingButton>
        <BingButton html-type="submit" :form="saveFormId" :loading="saving" :disabled="saveDisabled">确认保存版本</BingButton>
      </template>
    </BingDialog>
  </main>
</template>

<style scoped>
.document-status { display: grid; gap: 8px; }
.document-status > span:first-child { color: var(--bing-muted); }
.document-status__current { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.document-status__current i { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; }
.document-status__actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
