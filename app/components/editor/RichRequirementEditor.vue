<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, toRaw, useId, watch, type Component } from 'vue'
import { bingToast } from '@moubing/bing-ui'
import type { Editor, JSONContent } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { TableKit } from '@tiptap/extension-table'
import { ScrollbarCodeBlock } from './scrollbar-node-views'
import { ResizableTable } from './resizable-table'
import { EditableTaskItem, RequirementTaskList } from './task-list-extension'
import { EditableDetails, EditableDetailsContent, RequirementDetailsSummary } from './details-extension'
import { pageScrollViewportKey } from '~/utils/page-scroll-context'
import RequirementChapterLinks from './RequirementChapterLinks.vue'
import { caretChapterHeading, chapterHeadingSelector, copyChapterLink, findChapterHeading } from './chapter-link'
import { Markdown } from '@tiptap/markdown'
import Collaboration from '@tiptap/extension-collaboration'
import { RequirementCollaborationCaret } from './collaboration-caret-extension'
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Bold,
  ChevronDown,
  CodeXml,
  ClipboardPaste,
  Columns3,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  History,
  Image as ImageIcon,
  Italic,
  LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  MessageSquarePlus,
  MessageSquareText,
  PanelTop,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Scissors,
  Strikethrough,
  Table2,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextSelect,
  Trash2,
  Undo2,
  Unlink2,
} from 'lucide-vue-next'
import {
  BingButton,
  BingDialog,
  BingDropDown,
  BingDropDownItem,
  BingIcon,
  BingImagePreview,
  BingScrollbar,
  BingTooltip,
  type BingImagePreviewItem,
  type BingScrollbarExpose,
} from '@moubing/bing-ui'

import {
  cloneRichTextDocument,
  createDiffId,
  ensureBlockIds,
  extractPlainText,
  type RichTextDocument,
  type RichTextNode,
} from '~~/shared/editor/document'
import { normalizeTrailingParagraph } from '~~/shared/editor/trailing-paragraph'
import { clipboardImageFileName, extractClipboardImageFiles } from '~~/shared/editor/clipboard'
import {
  attachDocumentLayoutMotion,
  DOCUMENT_LAYOUT_MOTION_META,
} from './document-layout-motion'
import { resolveEditorContextTarget, type EditorContextTarget } from './editor-context-menu'
import { resolveEditorScrollViewportHeight } from './editor-scroll-viewport'
import { attachReadingAnchor } from './reading-anchor'
import { editorActiveStateKey, editorEditableStateKey, editorVisualStateKey } from './editor-visual-state'
import { displayCalloutTone, type CalloutTone } from '~~/shared/editor/callout'
import { setCalloutTone } from './callout-commands'
import CalloutToneItems from './CalloutToneItems.vue'
import { useActiveVisualEffect } from '../../composables/use-active-visual-effect'
import { detailReturnTiming } from '../../utils/detail-return-timing'
import {
  fitImageDisplaySize,
  type ImageDisplaySize,
} from './image-display-size'
import {
  addImageUploadPlaceholder,
  clearImageUploadPlaceholders,
  findImageUploadPlaceholderPosition,
  ImageUploadPlaceholder,
  imageUploadPlaceholderPluginKey,
  removeImageUploadPlaceholder,
  updateImageUploadPlaceholder,
} from './image-upload-placeholder'
import {
  discardUploadedImageTransition,
  stageUploadedImageTransition,
} from './uploaded-image-transition'
import RequirementLinkMenu from './RequirementLinkMenu.vue'
import RequirementOutline from './RequirementOutline.vue'
import RequirementEditorToolbarControls from './RequirementEditorToolbarControls.vue'
import { editorFormatGroups } from './editor-toolbar'
import RequirementAnnotationOverlay from './RequirementAnnotationOverlay.vue'
import RequirementVersionMarkers from './RequirementVersionMarkers.vue'
import { restoreVersionChange } from './version-marker-restore'
import { ImageSourcePolicy } from './image-source-policy'
import type { RevertChangePayload } from '~~/shared/diff/revert-draft-change'
import type { ContentComparison, VersionMarker } from '~~/shared/diff/version-markers'
import { captureAnnotation } from './annotation-capture'
import { attachObjectLongPress, keyboardObjectElement, objectTargetsAtElement } from './annotation-object-menu'
import { ANNOTATION_EDIT_EXTERNAL, createAnnotationEditGuard } from './annotation-edit-guard'
import { resolveAnnotation, objectTargetLabel, objectTargetPresentation, type AiAnnotation, type ObjectAnnotationTarget } from '~~/shared/agent/annotations'
import { CaretGapGuard } from './caret-gap-guard-extension'
import { SmoothCaret } from './smooth-caret-extension'
import { EDITOR_ACTIVITY_CHANGE_EVENT, EDITOR_READING_POSITION_RESTORED_EVENT } from './editor-layout-events'
import { TypingMarks } from './typing-marks-extension'
import { EmptyParagraphHint } from './empty-paragraph-hint-extension'
import { BlockId, Callout, EditorClipboard, ImageCaption, MarkdownPaste, RequirementImage } from './tiptap-extensions'
import { createSlashCommands, type SlashMenuState } from './slash-command-extension'
import RequirementSlashMenu from './RequirementSlashMenu.vue'
import { writeEditorSelectionToClipboard } from './clipboard-extension'
import { useSelectionMenuMotion } from './use-selection-menu-motion'
import { createSelectionMenuPointerController } from './selection-menu-interaction'
import { captureSelectionHistoryAnchor } from './selection-history-capture'
import { useRequirementOutline } from './use-requirement-outline'
import { useUploadedImageAutoScroll } from './use-uploaded-image-auto-scroll'
import type { SelectionHistoryAnchor } from '~~/shared/diff/selection-history'
import type { LocalImageUpload } from '~~/shared/drafts/document'
import type { CollaborativeEditorOptions } from '../../composables/use-requirement-collaboration'
import { captureCollaborativePosition, restoreCollaborativePosition } from './collaboration-positions'

const props = withDefaults(defineProps<{
  modelValue: RichTextDocument
  requirementId?: string
  allowImageUpload?: boolean
  allowedImageSources?: readonly string[]
  allowSelectionHistory?: boolean
  chapterNavigationPending?: boolean
  disabled?: boolean
  active?: boolean
  hideOutline?: boolean
  externalOutline?: boolean
  fillHeight?: boolean
  viewportBottomGap?: number
  outlineActive?: boolean
  annotations?: AiAnnotation[]
  activeAnnotationId?: string
  annotationDraft?: AiAnnotation | null
  annotationComment?: string
  annotationError?: string
  initialUploads?: LocalImageUpload[]
  prepareImageUpload?: () => Promise<string>
  collaboration?: CollaborativeEditorOptions
  versionComparison?: ContentComparison | null
  versionMarkers?: VersionMarker[]
  versionNumber?: number
  versionPending?: boolean
  versionReadOnly?: boolean
  versionRestoreDisabledReason?: string
  versionCompareDisabled?: boolean
}>(), { active: true, allowImageUpload: true, allowSelectionHistory: true })
provide(editorVisualStateKey, computed(() => props.active !== false && !props.disabled))
provide(editorActiveStateKey, computed(() => props.active !== false))

interface ImageUploadState {
  uploading: number
  failed: number
}

interface UploadedImageAsset {
  url: string
  fileName: string
}

const emit = defineEmits<{
  'update:modelValue': [value: RichTextDocument]
  'image-upload-state': [state: ImageUploadState]
  'upload-checkpoint': [uploads: LocalImageUpload[]]
  'show-selection-history': [anchor: SelectionHistoryAnchor]
  'add-annotation': [annotation: AiAnnotation]
  'select-annotation': [id: string]
  'update:annotationComment': [value: string]
  'save-annotation': []
  'cancel-annotation': []
  'remove-annotations': [ids: string[]]
  'compare-version-change': [marker: VersionMarker]
  error: [message: string]
}>()

interface ImageUploadTask {
  id: string
  file?: File
  imageDiffId: string
  mimeType: string
  size: number
  uploadName: string
  previewUrl?: string
  order: number
  status: 'queued' | 'uploading' | 'error'
  controller?: AbortController
  asset?: UploadedImageAsset
  displaySize?: ImageDisplaySize
  previewHandedOff?: boolean
}

const uploadInput = ref<HTMLInputElement | null>(null)
const applyingExternalValue = ref(false)
const editorStateRevision = ref(0)
const previewOpen = ref(false)
const previewIndex = ref(0)
const toolbarLinkMenuOpen = ref(false)
const selectionLinkMenuOpen = ref(false)
const tableMenuOpen = ref(false)
const tableGridRows = ref(3)
const tableGridColumns = ref(3)
const editorRoot = ref<HTMLElement | null>(null)
const editorToolbar = ref<HTMLElement | null>(null)
const editorScrollbar = ref<BingScrollbarExpose | null>(null)
if (props.requirementId) useRequirementReadingPosition(() => props.requirementId, editorScrollbar, () => props.active !== false, () => editor.value?.view.dom, () => !props.chapterNavigationPending)
const getPageScrollViewport = inject(pageScrollViewportKey, () => null)
const editorViewportHeight = ref(560)
const editorToolbarHeight = ref(53)
const selectionMenuItemsRoot = ref<HTMLElement | null>(null)
const selectionMenuMotion = useSelectionMenuMotion(selectionMenuItemsRoot)
const SELECTION_MENU_PLUGIN_KEY = 'requirementSelectionMenu'
const SELECTION_MENU_UPDATE_DELAY = 160
const uploadedImageAutoScroll = useUploadedImageAutoScroll(() => editorScrollbar.value)
const imageUploadTasks = new Map<string, ImageUploadTask>()
let imageUploadQueue = Promise.resolve()
let imageUploadOrder = 0
let disposingUploads = false
let uploadCheckpointQueued = false
let uploadCheckpointSignature = ''
let restoredUploads = false
const editorContextTarget = shallowRef<EditorContextTarget>({
  kind: 'text',
  element: null,
  label: '文本',
})

const TABLE_GRID_SIZE = 8
const tableGridCells = Array.from({ length: TABLE_GRID_SIZE ** 2 }, (_, index) => ({
  row: Math.floor(index / TABLE_GRID_SIZE) + 1,
  column: (index % TABLE_GRID_SIZE) + 1,
}))
const editorScrollStyle = computed(() => ({
  '--requirement-editor-viewport-height': `${editorViewportHeight.value}px`,
}))

let editorViewportResizeObserver: ResizeObserver | null = null
let editorViewportResizeFrame = 0

function updateEditorViewportHeight() {
  editorViewportResizeFrame = 0
  if (props.active === false) return
  const measuredToolbarHeight = Math.ceil(editorToolbar.value?.getBoundingClientRect().height ?? 0)
  if (measuredToolbarHeight > 0 && measuredToolbarHeight !== editorToolbarHeight.value) {
    editorToolbarHeight.value = measuredToolbarHeight
  }

  const scrollViewport = editorScrollbar.value?.viewport
  if (!scrollViewport) return

  const viewportHeight = Math.floor(
    window.visualViewport?.height
      ?? document.documentElement.clientHeight
      ?? window.innerHeight,
  )
  const containerDocumentTop = scrollViewport.getBoundingClientRect().top
    + (getPageScrollViewport()?.scrollTop ?? window.scrollY)
  const nextHeight = resolveEditorScrollViewportHeight({
    viewportHeight,
    containerDocumentTop,
    bottomGap: props.viewportBottomGap,
    minimumHeight: props.fillHeight ? 0 : undefined,
  })
  if (nextHeight === null || nextHeight === editorViewportHeight.value) return

  editorViewportHeight.value = nextHeight
  void nextTick(() => editorScrollbar.value?.update())
}

function scheduleEditorViewportMeasurement() {
  if (props.active === false || editorViewportResizeFrame) return
  editorViewportResizeFrame = window.requestAnimationFrame(updateEditorViewportHeight)
}

useActiveVisualEffect(() => props.active !== false, () => {
  if (typeof ResizeObserver !== 'undefined') {
    editorViewportResizeObserver = new ResizeObserver(scheduleEditorViewportMeasurement)
    const observedElements = [
      editorRoot.value,
      editorToolbar.value,
      editorRoot.value?.parentElement ?? null,
    ]
    observedElements.forEach((element) => {
      if (element) editorViewportResizeObserver?.observe(element)
    })
  }

  window.addEventListener('resize', scheduleEditorViewportMeasurement)
  window.visualViewport?.addEventListener('resize', scheduleEditorViewportMeasurement)
  scheduleEditorViewportMeasurement()
  return () => {
    if (editorViewportResizeFrame) window.cancelAnimationFrame(editorViewportResizeFrame)
    editorViewportResizeFrame = 0
    editorViewportResizeObserver?.disconnect()
    editorViewportResizeObserver = null
    window.removeEventListener('resize', scheduleEditorViewportMeasurement)
    window.visualViewport?.removeEventListener('resize', scheduleEditorViewportMeasurement)
  }
})

const normalizedContent = computed(() => normalizeTrailingParagraph(ensureBlockIds(cloneRichTextDocument(props.modelValue))))
const editorDocument = shallowRef(normalizedContent.value)
const annotationEditIds = shallowRef<string[] | null>(null)
const annotationEditHintId = `annotation-edit-hint-${useId()}`
const annotationEditGuard = createAnnotationEditGuard({
  enabled: () => !props.disabled && props.active !== false && !applyingExternalValue.value,
  annotations: () => props.annotations ?? [],
  request: ids => { annotationEditIds.value = ids },
  remove: ids => emit('remove-annotations', ids),
  stale: () => emit('error', '正文已变化，本次输入已取消，请重新输入。'),
})
watch(() => [props.active, props.disabled], () => {
  if (props.active === false || props.disabled) annotationEditGuard.cancel()
})
let lastEmittedContent: RichTextDocument | undefined
type PreviewItem = BingImagePreviewItem & { diffId: string }
const previewItems = computed<PreviewItem[]>(() => collectPreviewItems(editorDocument.value))
const slashMenu = shallowRef<SlashMenuState | null>(null)
const slashCommands = createSlashCommands({
  enabled: () => !props.disabled && props.active !== false && !applyingExternalValue.value && !annotationEditIds.value,
  update: state => { slashMenu.value = state },
  pickImage,
  allowImage: () => props.allowImageUpload,
})
watch(() => [props.active, props.disabled], () => {
  if (props.active === false || props.disabled) slashCommands.close()
})

const editor = useEditor({
  content: props.collaboration ? undefined : normalizedContent.value,
  editable: !props.disabled,
  onCreate: async ({ editor: instance }) => {
    await nextTick()
    // BubbleMenu 注册插件时，Yjs 的首次重绘可能使 Vue Editor 与 view 的插件集暂时不同。
    // 在首次用户操作前同步空事务，避免第一次改语气/输入时重建插件而被旧 Yjs 内容覆盖。
    if (!instance.isDestroyed && instance.state.plugins !== instance.view.state.plugins) {
      instance.view.dispatch(instance.state.tr.setMeta('addToHistory', false))
    }
  },
  // MarkdownPaste 统一负责纯文本 Markdown；默认 mark 粘贴规则会改写富文本里的字面语法。
  enablePasteRules: false,
  extensions: [
    StarterKit.configure({
      undoRedo: props.collaboration ? false : {},
      heading: { levels: [1, 2, 3] },
      link: false,
      codeBlock: false,
    }),
    ScrollbarCodeBlock.configure({ HTMLAttributes: { spellcheck: 'false' } }),
    RequirementTaskList,
    EditableTaskItem,
    EditableDetails,
    EditableDetailsContent,
    RequirementDetailsSummary,
    Link.configure({
      openOnClick: true,
      enableClickSelection: true,
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: {
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'requirement-editor__link',
      },
    }),
    RequirementImage.configure({
      inline: false,
      allowBase64: false,
    }),
    ImageCaption,
    Highlight,
    Typography,
    TableKit.configure({ table: false }),
    ResizableTable.configure({ isActive: () => props.active !== false }),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
    BlockId,
    annotationEditGuard.extension,
    slashCommands.extension,
    CaretGapGuard,
    SmoothCaret.configure({ isActive: () => props.active !== false }),
    TypingMarks,
    EmptyParagraphHint,
    ImageUploadPlaceholder,
    Callout,
    EditorClipboard,
    MarkdownPaste,
    ...(props.allowedImageSources ? [ImageSourcePolicy.configure({ sources: props.allowedImageSources,
      onBlocked: () => emit('error', '此编辑器仅支持预置图片，未插入其他图片。') })] : []),
    ...(props.collaboration ? [
      Collaboration.configure({ document: props.collaboration.document }),
      RequirementCollaborationCaret.configure({ provider: props.collaboration.provider, user: props.collaboration.user }),
    ] : []),
  ],
  editorProps: {
    scrollThreshold: { top: 28, right: 0, bottom: 28, left: 0 },
    scrollMargin: { top: 28, right: 5, bottom: 28, left: 5 },
    attributes: {
      class: 'requirement-editor__surface',
      spellcheck: 'false',
    },
    handleDOMEvents: {
      paste(_view, event) {
        if (props.allowImageUpload || !event.clipboardData?.files.length) return false
        event.preventDefault()
        emit('error', '此编辑器不支持上传或粘贴文件，可编辑文字和预置图片题注。')
        return true
      },
      drop(_view, event) {
        if (props.allowImageUpload || !event.dataTransfer?.files.length) return false
        event.preventDefault()
        emit('error', '此编辑器不支持拖入文件。')
        return true
      },
    },
    handlePaste(_view, event) {
      if (props.disabled) return false
      if (event.clipboardData?.getData('text/html').includes('data-pm-slice')) return false
      const imageFiles = extractClipboardImageFiles(event.clipboardData)
      if (!imageFiles.length) return false

      queueImageUploadFiles(imageFiles)
      return true
    },
  },
  onUpdate: ({ editor }) => {
    if (applyingExternalValue.value) return
    const endExport = detailReturnTiming(props.requirementId)?.start('document-export')
    // BlockId 已在事务中维护身份；导出不再遍历整篇重修 ID，也不改写远端身份。
    const value = editor.getJSON() as RichTextDocument
    editorDocument.value = lastEmittedContent = value
    emit('update:modelValue', value)
    endExport?.()
  },
  onTransaction: () => {
    editorStateRevision.value += 1
    if (imageUploadTasks.size) scheduleUploadCheckpoint()
  },
})

watch(() => props.active, () => {
  editor.value?.view.dom.dispatchEvent(new Event(EDITOR_ACTIVITY_CHANGE_EVENT))
}, { flush: 'post' })

watch(editor, instance => {
  if (!instance || restoredUploads) return
  restoredUploads = true
  for (const upload of props.initialUploads ?? []) {
    let inserted = false
    instance.state.doc.descendants(node => { if (node.attrs.diffId === upload.imageDiffId) inserted = true })
    if (inserted) continue
    const file = upload.file ? new File([upload.file], upload.fileName, { type: upload.mimeType }) : undefined
    const task: ImageUploadTask = { id: upload.id, imageDiffId: upload.imageDiffId, file,
      uploadName: upload.fileName, mimeType: upload.mimeType, size: upload.size, order: upload.order,
      previewUrl: file ? createImagePreviewUrl(file) : undefined, status: 'queued' }
    imageUploadTasks.set(task.id, task)
    imageUploadOrder = Math.max(imageUploadOrder, task.order)
    addImageUploadPlaceholder(instance.view, { id: task.id, fileName: task.uploadName, previewUrl: task.previewUrl, relativePosition: upload.relativePosition,
      status: 'uploading', order: task.order }, restoreCollaborativePosition(instance, props.collaboration?.document, upload.relativePosition, upload.position))
    enqueueImageUpload(task.id)
  }
  emitImageUploadState()
}, { immediate: true })

const requirementOutline = useRequirementOutline({
  active: computed(() => props.active !== false),
  enabled: computed(() => props.active !== false && (props.externalOutline ? props.outlineActive === true : !props.hideOutline)),
  ignoreCompact: computed(() => Boolean(props.externalOutline)),
  editor,
  content: editorDocument,
  getScrollController: () => editorScrollbar.value,
  onArrive: id => chapterLinks.value?.highlight(id),
})
const annotationOverlay = shallowRef<InstanceType<typeof RequirementAnnotationOverlay> | null>(null)
const chapterLinks = shallowRef<InstanceType<typeof RequirementChapterLinks> | null>(null)
const versionOverlay = shallowRef<InstanceType<typeof RequirementVersionMarkers> | null>(null)
defineExpose({ outline: requirementOutline, viewportHeight: editorViewportHeight, toolbarHeight: editorToolbarHeight,
  restoreChange: (base: RichTextDocument, change: RevertChangePayload) => {
    if (!editor.value || props.disabled) return false
    return restoreVersionChange(editor.value, base, change)
  },
  async navigateToChapter(id: string, signal: AbortSignal): Promise<'reached' | 'missing' | 'cancelled'> {
    await nextTick()
    // 首次排版才会请求正文字体；等字体和 ResizeObserver/阅读锚点写入完成再开始滚动。
    const layoutFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await layoutFrame()
    if (document.fonts?.status === 'loading') await document.fonts.ready
    await layoutFrame()
    if (signal.aborted || !editor.value || props.active === false) return 'cancelled'
    const viewport = editorScrollbar.value?.viewport
    if (!findChapterHeading(editor.value.view.dom, id)) {
      editorScrollbar.value?.stop()
      if (viewport) { viewport.scrollTop = 0; viewport.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT)) }
      return 'missing'
    }
    const reached = await requirementOutline.scrollToHeading(id, false, signal)
    if (!reached || signal.aborted) return 'cancelled'
    return 'reached'
  },
  nextVersionChange: () => versionOverlay.value?.next(),
  getBlockElement: (id: string) => {
    let element: HTMLElement | null = null
    editor.value?.state.doc.descendants((node, pos) => {
      if (node.attrs.diffId !== id) return
      const dom = editor.value!.view.nodeDOM(pos)
      if (dom instanceof HTMLElement) element = dom
      return false
    })
    return element
  },
  scrollToAnnotation: (id: string) => {
    setSelectionMenuMeta('hide')
    return annotationOverlay.value?.scrollTo(id)
  } })

let detachDocumentLayoutMotion: (() => void) | null = null
let detachReadingAnchor: (() => void) | undefined
watch([editor, editorScrollbar, () => props.active], ([instance, scrollbar, active]) => {
  detachReadingAnchor?.()
  detachReadingAnchor = active !== false && instance && scrollbar?.viewport
    ? attachReadingAnchor(instance.view.dom, scrollbar.viewport, () => scrollbar.stop(),
      () => Boolean(props.chapterNavigationPending || requirementOutline.scrolling.value)) : undefined
}, { flush: 'post' })
watch(() => props.chapterNavigationPending, (pending, previous) => {
  // 等待字体期间也可能被用户取消；无论是否启动动画，结束时都丢弃旧阅读锚点。
  if (previous && !pending) editorScrollbar.value?.viewport?.dispatchEvent(new Event(EDITOR_READING_POSITION_RESTORED_EVENT))
}, { flush: 'post' })

watch(
  editor,
  (instance) => {
    detachDocumentLayoutMotion?.()
    detachDocumentLayoutMotion = null
    if (!instance) return

    detachDocumentLayoutMotion = attachDocumentLayoutMotion(instance, {
      getViewport: () => editorScrollbar.value?.viewport,
      isEnabled: () => props.active !== false && !props.disabled && !applyingExternalValue.value,
    })
  },
  { immediate: true },
)

const canUndo = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  return Boolean(instance && !props.disabled && instance.can().undo())
})

const canRedo = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  return Boolean(instance && !props.disabled && instance.can().redo())
})

const hasSelection = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  return Boolean(instance && !props.disabled && !instance.state.selection.empty)
})

const canPastePlainText = computed(
  () =>
    Boolean(editor.value) &&
    !props.disabled &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.readText === 'function',
)

const linkCommandState = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  const active = Boolean(instance?.isActive('link'))
  const selection = instance?.state.selection
  const canOpen = Boolean(
    instance &&
      !props.disabled &&
      selection instanceof TextSelection &&
      !instance.isActive('codeBlock'),
  )

  return {
    active,
    canOpen,
    hasSelection: Boolean(selection && !selection.empty),
    href: active ? String(instance?.getAttributes('link').href ?? '') : '',
    selectedText: instance && selection instanceof TextSelection ? getSelectedText(instance) : '',
  }
})

watch(toolbarLinkMenuOpen, (open) => {
  if (open) selectionLinkMenuOpen.value = false
})

watch(selectionLinkMenuOpen, (open) => {
  if (open) toolbarLinkMenuOpen.value = false
})

watch(
  () => props.disabled,
  (disabled) => {
    const timing = detailReturnTiming(props.requirementId)
    const endEditable = timing?.start('set-editable')
    // 权限/恢复状态不改变正文；默认 update 事件会白做全文导出和 v-model 回传。
    editor.value?.setEditable(!disabled, false)
    endEditable?.()
    if (!disabled && props.active !== false) timing?.editorReady()
  },
)

watch(
  () => props.modelValue,
  async (value) => {
    const instance = editor.value
    if (!instance) return
    // v-model 回传同一个 JSON 对象时，编辑器已经应用了该事务。
    if (toRaw(value) === lastEmittedContent) return
    const nextJson = JSON.stringify(value)
    const currentJson = JSON.stringify(instance.getJSON())
    if (nextJson === currentJson) return

    if (props.collaboration) {
      // Diff 撤销等外部修改只替换实际变化的范围，保留其他人的编辑和图片任务。
      const next = instance.schema.nodeFromJSON(value)
      const start = instance.state.doc.content.findDiffStart(next.content)
      if (start === null) return
      const end = instance.state.doc.content.findDiffEnd(next.content)!
      const overlap = start - Math.min(end.a, end.b)
      if (overlap > 0) { end.a += overlap; end.b += overlap }
      instance.view.dispatch(instance.state.tr.replace(start, end.a, next.slice(start, end.b)).setMeta(ANNOTATION_EDIT_EXTERNAL, true))
      return
    }

    cancelAllImageUploads()
    applyingExternalValue.value = true
    const normalized = normalizeTrailingParagraph(ensureBlockIds(cloneRichTextDocument(value)))
    instance.commands.setContent(normalized, { emitUpdate: false })
    editorDocument.value = normalized
    await nextTick()
    applyingExternalValue.value = false
  },
)

function isActive(name: string, attrs?: Record<string, unknown>) {
  editorStateRevision.value
  return Boolean(editor.value?.isActive(name, attrs))
}

function run(command: () => void) {
  if (!editor.value || props.disabled) return
  command()
  editor.value.commands.focus()
}

const tableCommandState = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  const active = Boolean(instance?.isActive('table'))

  return {
    active,
    canInsert: Boolean(
      instance &&
        !props.disabled &&
        !active &&
        instance.can().insertTable({ rows: tableGridRows.value, cols: tableGridColumns.value, withHeaderRow: true }),
    ),
    canAddColumnBefore: Boolean(instance && !props.disabled && active && instance.can().addColumnBefore()),
    canAddColumnAfter: Boolean(instance && !props.disabled && active && instance.can().addColumnAfter()),
    canDeleteColumn: Boolean(instance && !props.disabled && active && instance.can().deleteColumn()),
    canAddRowBefore: Boolean(instance && !props.disabled && active && instance.can().addRowBefore()),
    canAddRowAfter: Boolean(instance && !props.disabled && active && instance.can().addRowAfter()),
    canDeleteRow: Boolean(instance && !props.disabled && active && instance.can().deleteRow()),
    canToggleHeaderRow: Boolean(instance && !props.disabled && active && instance.can().toggleHeaderRow()),
    canDeleteTable: Boolean(instance && !props.disabled && active && instance.can().deleteTable()),
  }
})

type ContextImageAlignment = 'left' | 'center' | 'right'

const imageContextCommandState = computed(() => {
  editorStateRevision.value
  const instance = editor.value
  const active = Boolean(instance?.isActive('image'))
  const rawAlignment = active ? instance?.getAttributes('image').align : 'center'
  const alignment: ContextImageAlignment =
    rawAlignment === 'left' || rawAlignment === 'right' ? rawAlignment : 'center'

  return {
    active,
    alignment,
    canDelete: Boolean(instance && !props.disabled && active && instance.can().deleteSelection()),
    canUpdate: Boolean(instance && !props.disabled && active),
  }
})

const editorContextMenuLabel = computed(() => editorContextTarget.value.label)
provide(editorEditableStateKey, computed(() => !props.disabled && props.active !== false))
const contextCalloutId = ref('')
const contextCalloutTone = computed(() => {
  editorStateRevision.value
  let tone: unknown
  editor.value?.state.doc.descendants(node => {
    if (node.type.name === 'callout' && node.attrs.diffId === contextCalloutId.value) tone = node.attrs.tone
  })
  return displayCalloutTone(tone)
})
function freezeCalloutTarget(element: Element | null) {
  contextCalloutId.value = element?.closest<HTMLElement>('[data-requirement-callout]')?.dataset.diffId ?? ''
}
function switchContextCallout(tone: CalloutTone) {
  run(() => setCalloutTone(editor.value!, contextCalloutId.value, tone))
}
function insertCallout(tone: CalloutTone) {
  run(() => editor.value!.commands.insertCallout({ tone }))
}
const objectAnnotationTargets = shallowRef<ObjectAnnotationTarget[]>([])
const editorContextOpen = ref(false)
const contextChapterId = ref('')
function freezeChapterTarget(element: Element | null, keyboard = false) {
  const target = element?.closest<HTMLElement>(chapterHeadingSelector)
    ?? (keyboard && editor.value ? caretChapterHeading(editor.value) : null)
  contextChapterId.value = props.requirementId && target && editor.value?.view.dom.contains(target) ? target.dataset.diffId ?? '' : ''
}
function copyContextChapter() {
  editorContextOpen.value = false
  void copyChapterLink(props.requirementId!, contextChapterId.value)
}
const contextVersionMarkerId = ref('')
const contextVersionMarker = computed(() => props.versionMarkers?.find(marker => marker.id === contextVersionMarkerId.value))
function freezeVersionTarget(element: Element | null) {
  contextVersionMarkerId.value = ''
  const instance = editor.value
  if (!instance || !props.versionMarkers?.length) return
  const ids = new Set<string>()
  while (element && instance.view.dom.contains(element)) {
    if (element instanceof HTMLElement && element.dataset.diffId) ids.add(element.dataset.diffId)
    element = element.parentElement
  }
  if (!ids.size) {
    const { $from } = instance.state.selection
    for (let depth = $from.depth; depth > 0; depth--) ids.add($from.node(depth).attrs.diffId)
    if ($from.nodeAfter?.attrs.diffId) ids.add($from.nodeAfter.attrs.diffId)
  }
  contextVersionMarkerId.value = props.versionMarkers.find(marker => marker.targetId && ids.has(marker.targetId))?.id ?? ''
}
async function openContextVersionChange() {
  const marker = contextVersionMarker.value
  if (!marker || props.versionPending) return
  editorContextOpen.value = false
  await nextTick()
  void versionOverlay.value?.open(marker)
}
function restoreVersionMarker(marker: VersionMarker) {
  if (!editor.value || props.disabled || props.versionReadOnly || props.versionPending || props.versionRestoreDisabledReason
    || !props.versionComparison || props.versionComparison.target !== toRaw(props.modelValue)) return
  const current = props.versionMarkers?.find(item => item.id === marker.id)
  if (current) restoreVersionChange(editor.value, props.versionComparison.base, current)
}
const contextSurface = ref<HTMLElement>()
useActiveVisualEffect(() => props.active !== false && Boolean(props.annotations && contextSurface.value && editor.value), () => {
  const detach = attachObjectLongPress(editor.value!, contextSurface.value!)
  return () => { detach(); editorContextOpen.value = false; objectAnnotationTargets.value = [] }
})

function freezeObjectTargets(element: Element | null) {
  objectAnnotationTargets.value = []
  if (!editor.value || !props.annotations) return
  try { objectAnnotationTargets.value = objectTargetsAtElement(editor.value, element) }
  catch (error) { emit('error', error instanceof Error ? error.message : '对象暂不可标注。') }
}

function handleContextKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  if (!editor.value) return
  const element = keyboardObjectElement(editor.value, event.target)
  freezeChapterTarget(element, true)
  freezeCalloutTarget(element)
  freezeVersionTarget(element)
  freezeObjectTargets(element)
  editorContextTarget.value = resolveEditorContextTarget(element)
  if (props.annotations && !element && !editor.value.state.selection.empty) emit('error', '请先聚焦一个可标注的节点，再打开对象菜单。')
}

async function addObjectAnnotation(target: ObjectAnnotationTarget) {
  if (!editor.value) return
  const note: AiAnnotation = { id: crypto.randomUUID(), target, quote: target.summary || objectTargetLabel(target), section: '', segments: [], comment: '' }
  const resolved = resolveAnnotation(note, editor.value.getJSON())
  if (resolved.status === 'unresolved') { emit('error', resolved.reason); return }
  editorContextOpen.value = false
  setSelectionMenuMeta('hide')
  editor.value.view.dom.focus({ preventScroll: true })
  await nextTick()
  emit('add-annotation', note)
}
const editorContextLinkHref = computed(() =>
  editorContextTarget.value.kind === 'link' ? editorContextTarget.value.href : '',
)
const editorContextMenuAriaLabel = computed(() => {
  const labels = {
    text: '文本右键菜单',
    table: '表格右键菜单',
    image: '图片右键菜单',
    link: '链接右键菜单',
  }
  return labels[editorContextTarget.value.kind]
})

function selectTableGridSize(row: number, column: number) {
  tableGridRows.value = row
  tableGridColumns.value = column
}

function resetTableGridSize() {
  if (!tableCommandState.value.active) {
    selectTableGridSize(3, 3)
  }
}

function insertTable(rows: number, columns: number) {
  const instance = editor.value
  if (!instance || props.disabled || instance.isActive('table')) return

  const inserted = instance
    .chain()
    .focus()
    .insertTable({ rows, cols: columns, withHeaderRow: true })
    .run()

  if (inserted) {
    tableMenuOpen.value = false
  }
}

function setContextTextSelection(event: MouseEvent) {
  const instance = editor.value
  if (!instance) return
  const position = instance.view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!position) return
  const $position = instance.state.doc.resolve(position.pos)
  // 单元格留白可能命中容器边界；落到有效选区，末尾向内查找以免跳入下一格。
  const bias = $position.parentOffset === $position.parent.content.size ? -1 : 1
  const selection = Selection.near($position, bias)
  if (!selection.eq(instance.state.selection)) instance.view.dispatch(instance.state.tr.setSelection(selection))
}

function handleEditorContextMouseDown(event: MouseEvent) {
  const instance = editor.value
  if (event.button !== 2 || event.defaultPrevented || !instance || props.disabled || instance.view.composing) return
  if (resolveEditorContextTarget(event.target).kind !== 'table') return
  // 在浏览器默认定位前统一处理，避免按下时先移动一次、菜单打开时再修正一次。
  event.preventDefault()
  setContextTextSelection(event)
  instance.view.focus()
}

function setContextLinkSelection(link: HTMLAnchorElement, event: MouseEvent) {
  const instance = editor.value
  if (!instance) return

  try {
    const from = instance.view.posAtDOM(link, 0, 1)
    const to = instance.view.posAtDOM(link, link.childNodes.length, -1)
    if (from !== to) {
      instance.commands.setTextSelection({ from: Math.min(from, to), to: Math.max(from, to) })
      return
    }
  } catch {
    // Fall through to coordinate-based selection for custom link DOM.
  }

  setContextTextSelection(event)
}

function setContextImageSelection(image: HTMLElement, event: MouseEvent) {
  const instance = editor.value
  if (!instance) return

  try {
    const position = instance.view.posAtDOM(image, 0, -1)
    if (instance.commands.setNodeSelection(position)) return
  } catch {
    // Fall through to the document position under the pointer.
  }

  const position = instance.view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!position) return
  const resolved = instance.state.doc.resolve(position.pos)
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name !== 'image') continue
    instance.commands.setNodeSelection(resolved.before(depth))
    return
  }
}

function handleEditorContextMenu(event: MouseEvent) {
  freezeChapterTarget(event.target instanceof Element ? event.target : null)
  freezeCalloutTarget(event.target instanceof Element ? event.target : null)
  freezeVersionTarget(event.target instanceof Element ? event.target : null)
  freezeObjectTargets(event.target instanceof Element ? event.target : null)
  const target = resolveEditorContextTarget(event.target)
  editorContextTarget.value = target
  if (!editor.value || props.disabled) return

  if (target.kind === 'table') {
    setContextTextSelection(event)
    return
  }
  if (target.kind === 'image') {
    setContextImageSelection(target.element, event)
    return
  }
  if (target.kind === 'link') {
    setContextLinkSelection(target.element, event)
    return
  }
  if (target.kind === 'text') {
    const instance = editor.value
    const position = instance.view.posAtCoords({ left: event.clientX, top: event.clientY })
    const selection = instance.state.selection
    const clickInsideSelection =
      position
      && !selection.empty
      && position.pos >= selection.from
      && position.pos <= selection.to
    if (!clickInsideSelection) setContextTextSelection(event)
  }
}

function addAnnotation() {
  if (!editor.value) return
  try {
    const note = captureAnnotation(editor.value)
    setSelectionMenuMeta('hide')
    // 模态层关闭后回到稳定的添加入口，避免恢复正文焦点时重开选区菜单、盖住编号。
    editorToolbar.value?.querySelector<HTMLButtonElement>('[aria-label="添加 AI 标注"]')?.focus({ preventScroll: true })
    emit('add-annotation', note)
  }
  catch (error) { emit('error', error instanceof Error ? error.message : '无法标注此选区。') }
}
const canAnnotateSelection = computed(() => {
  editorStateRevision.value
  if (!editor.value) return false
  try { captureAnnotation(editor.value); return true } catch { return false }
})

function openSelectionHistory() {
  if (!props.allowSelectionHistory) return
  const instance = editor.value
  if (!instance) return
  const result = captureSelectionHistoryAnchor(instance)
  if (!result.ok) {
    emit('error', result.message)
    return
  }
  selectionLinkMenuOpen.value = false
  toolbarLinkMenuOpen.value = false
  emit('show-selection-history', result.anchor)
}

function setContextImageAlignment(alignment: ContextImageAlignment) {
  const instance = editor.value
  if (!instance || !imageContextCommandState.value.canUpdate) return
  run(() => instance.chain().focus().updateAttributes('image', { align: alignment }).run())
}

function previewContextImage() {
  const instance = editor.value
  if (!instance || !imageContextCommandState.value.active) return
  const attributes = instance.getAttributes('image')
  const index = previewItems.value.findIndex(
    item =>
      (attributes.diffId && item.diffId === attributes.diffId) ||
      (attributes.src && item.src === attributes.src),
  )
  if (index < 0) return
  previewIndex.value = index
  previewOpen.value = true
}

function deleteContextImage() {
  const instance = editor.value
  if (!instance || !imageContextCommandState.value.canDelete) return
  run(() => instance.commands.deleteSelection())
}

function openContextLink() {
  if (!editorContextLinkHref.value || typeof window === 'undefined') return
  window.open(editorContextLinkHref.value, '_blank', 'noopener,noreferrer')
}

async function copyContextLink() {
  if (!editorContextLinkHref.value) return
  const id = bingToast.loading({ message: '正在复制链接', position: 'top-center' })
  try {
    await navigator.clipboard.writeText(editorContextLinkHref.value)
    if (bingToast.getToasts().some(item => item.id === id)) bingToast.success({ id, message: '链接已复制', position: 'top-center' })
  } catch {
    emit('error', '复制链接失败，请手动复制')
    if (bingToast.getToasts().some(item => item.id === id)) bingToast.error({ id, message: '复制链接失败，请手动复制', position: 'top-center', duration: 6500 })
  }
}

function applyLink(value: { href: string; text?: string }) {
  const instance = editor.value
  if (!instance) return

  if (value.text) {
    run(() =>
      instance
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: value.text,
          marks: [{ type: 'link', attrs: { href: value.href } }],
        })
        .run(),
    )
    return
  }

  run(() => instance.chain().focus().extendMarkRange('link').setLink({ href: value.href }).run())
}

function removeLink() {
  const instance = editor.value
  if (!instance) return

  run(() => instance.chain().focus().extendMarkRange('link').unsetLink().run())
}

function canShowSelectionMenu(instance: Editor, from: number, to: number) {
  return (
    !props.disabled
    && !props.annotationDraft
    && !annotationEditIds.value
    && instance.isEditable
    && from !== to
    && instance.state.selection instanceof TextSelection
    && !instance.isActive('codeBlock')
  )
}

function setSelectionMenuMeta(meta: 'hide' | 'show' | 'updatePosition') {
  const instance = editor.value
  if (!instance || instance.isDestroyed) return
  instance.view.dispatch(instance.state.tr.setMeta(SELECTION_MENU_PLUGIN_KEY, meta))
}

watch(() => props.annotationDraft, draft => { if (draft) setSelectionMenuMeta('hide') })
watch(annotationEditIds, ids => { if (ids) setSelectionMenuMeta('hide') })

const selectionMenuPointer = createSelectionMenuPointerController({
  getSurface: () => editor.value?.view.dom,
  onSelectionStart: () => {
    selectionLinkMenuOpen.value = false
    setSelectionMenuMeta('hide')
  },
  onSelectionEnd: () => {
    const instance = editor.value
    if (!instance || instance.isDestroyed) return
    const { from, to } = instance.state.selection
    if (!canShowSelectionMenu(instance, from, to)) return

    setSelectionMenuMeta('show')
    setSelectionMenuMeta('updatePosition')
  },
})

useActiveVisualEffect(() => props.active !== false, () => {
  window.addEventListener('pointerup', selectionMenuPointer.handlePointerEnd, true)
  window.addEventListener('pointercancel', selectionMenuPointer.handlePointerCancel, true)
  window.addEventListener('blur', selectionMenuPointer.cancel)
  return () => {
    window.removeEventListener('pointerup', selectionMenuPointer.handlePointerEnd, true)
    window.removeEventListener('pointercancel', selectionMenuPointer.handlePointerCancel, true)
    window.removeEventListener('blur', selectionMenuPointer.cancel)
    selectionMenuPointer.cancel()
    setSelectionMenuMeta('hide')
    previewOpen.value = toolbarLinkMenuOpen.value = selectionLinkMenuOpen.value = tableMenuOpen.value = false
    editorScrollbar.value?.stop()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', selectionMenuPointer.handlePointerEnd, true)
  window.removeEventListener('pointercancel', selectionMenuPointer.handlePointerCancel, true)
  window.removeEventListener('blur', selectionMenuPointer.cancel)
  selectionMenuPointer.destroy()
})

function shouldShowSelectionMenu({
  editor: instance,
  from,
  to,
}: {
  editor: Editor
  from: number
  to: number
}) {
  return !selectionMenuPointer.isSuppressed() && canShowSelectionMenu(instance, from, to)
}

function getSelectedText(instance: Editor) {
  const { from, to } = instance.state.selection
  return instance.state.doc.textBetween(from, to, '\n')
}

async function copySelection() {
  const instance = editor.value
  if (!instance || props.disabled || instance.state.selection.empty) return

  instance.view.focus()

  try {
    if (typeof document.execCommand === 'function' && document.execCommand('copy')) return
    await writeEditorSelectionToClipboard(instance.view)
  } catch {
    emit('error', '复制失败，请使用 Ctrl+C')
  }
}

async function cutSelection() {
  const instance = editor.value
  if (!instance || props.disabled || instance.state.selection.empty) return

  instance.view.focus()

  try {
    if (typeof document.execCommand === 'function' && document.execCommand('cut')) return
    const { doc, selection } = instance.state
    await writeEditorSelectionToClipboard(instance.view)
    // 异步剪贴板授权期间文档或选区可能已经改变，不能删掉用户后来选择的内容。
    if (!instance.isDestroyed && instance.state.doc.eq(doc) && instance.state.selection.eq(selection)) {
      instance.commands.deleteSelection()
    }
  } catch {
    emit('error', '剪切失败，请使用 Ctrl+X')
  }
}

function createPlainTextContent(value: string): JSONContent[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const content: JSONContent[] = []

  lines.forEach((line, index) => {
    if (line) content.push({ type: 'text', text: line })
    if (index < lines.length - 1) content.push({ type: 'hardBreak' })
  })

  return content
}

async function pastePlainText() {
  const instance = editor.value
  if (!instance || props.disabled || !canPastePlainText.value) return

  try {
    const text = await navigator.clipboard.readText()
    const content = createPlainTextContent(text)
    if (!content.length) return
    instance.chain().focus().insertContent(content).run()
  } catch {
    emit('error', '浏览器未允许读取剪贴板，请使用 Ctrl+V')
  }
}

function pickImage() {
  if (!props.allowImageUpload) return
  uploadInput.value?.click()
}

function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) { slashCommands.close(); return }
  queueImageUploadFiles([file], slashCommands.isPickingImage())
}

function createImagePreviewUrl(file: File) {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
  try {
    return URL.createObjectURL(file)
  } catch {
    return undefined
  }
}

function revokeImagePreviewUrl(url?: string) {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(url)
}

function emitImageUploadState() {
  if (disposingUploads) return
  let uploading = 0
  let failed = 0
  imageUploadTasks.forEach((task) => {
    if (task.status === 'error') failed += 1
    else uploading += 1
  })
  emit('image-upload-state', { uploading, failed })
  emitUploadCheckpoint()
}

watch(() => [props.active, props.hideOutline, props.viewportBottomGap], () => {
  if (import.meta.client) void nextTick(scheduleEditorViewportMeasurement)
}, { flush: 'post' })

function scheduleUploadCheckpoint() {
  if (uploadCheckpointQueued || disposingUploads) return
  uploadCheckpointQueued = true
  queueMicrotask(() => { uploadCheckpointQueued = false; if (!disposingUploads) emitUploadCheckpoint() })
}

function emitUploadCheckpoint() {
  const instance = editor.value
  if (!instance || disposingUploads) return
  const uploads: LocalImageUpload[] = []
  imageUploadTasks.forEach(task => {
    const position = findImageUploadPlaceholderPosition(instance.view, task.id)
    if (position === undefined) return
    uploads.push({ id: task.id, imageDiffId: task.imageDiffId, fileName: task.uploadName, mimeType: task.mimeType,
      size: task.size, order: task.order, position, file: task.file,
      relativePosition: captureCollaborativePosition(instance, props.collaboration?.document, position) })
  })
  const signature = JSON.stringify(uploads.map(({ file: _file, ...upload }) => upload))
  if (signature === uploadCheckpointSignature) return
  uploadCheckpointSignature = signature
  emit('upload-checkpoint', uploads)
}

function queueImageUploadFiles(files: File[], fromSlashCommand = false) {
  if (!props.allowImageUpload) { slashCommands.close(); emit('error', '此编辑器不支持上传图片。'); return }
  const instance = editor.value
  if (!instance || props.disabled || !files.length) return

  files.forEach((file, index) => {
    if (imageUploadTasks.size >= 100) { if (fromSlashCommand) slashCommands.close(); emit('error', '最多同时处理 100 张待上传图片'); return }
    if (file.size > 5 * 1024 * 1024 || !file.size || !file.type.startsWith('image/')) {
      if (fromSlashCommand) slashCommands.close()
      emit('error', '请选择不超过 5 MB 的图片文件')
      return
    }
    const task: ImageUploadTask = {
      id: createDiffId('upload'),
      imageDiffId: createDiffId('img'),
      file,
      mimeType: file.type,
      size: file.size,
      uploadName: clipboardImageFileName(file, index).slice(0, 240),
      previewUrl: createImagePreviewUrl(file),
      order: ++imageUploadOrder,
      status: 'queued',
    }
    if (fromSlashCommand && !slashCommands.imagePicked(task.id)) { revokeImagePreviewUrl(task.previewUrl); return }
    const position = instance.state.selection.from
    imageUploadTasks.set(task.id, task)
    addImageUploadPlaceholder(instance.view, {
      id: task.id,
      fileName: task.uploadName,
      previewUrl: task.previewUrl,
      status: 'uploading',
      order: task.order,
    }, position)
    enqueueImageUpload(task.id)
  })

  emitImageUploadState()
}

function enqueueImageUpload(taskId: string) {
  imageUploadQueue = imageUploadQueue.then(
    () => performImageUpload(taskId),
    () => performImageUpload(taskId),
  )
}

async function performImageUpload(taskId: string) {
  const task = imageUploadTasks.get(taskId)
  if (!task) return

  task.status = 'uploading'
  task.controller = new AbortController()
  updateImageUploadPlaceholder(editor.value!.view, task.id, {
    status: 'uploading',
    errorMessage: undefined,
  })
  emitImageUploadState()

  const controller = task.controller
  try {
    const asset = task.asset ?? await uploadImageFile(task, controller.signal)
    if (imageUploadTasks.get(task.id) !== task || task.controller !== controller) return
    task.asset = asset

    const naturalSize = await preloadUploadedImage(asset.url, controller.signal)
    if (imageUploadTasks.get(task.id) !== task || task.controller !== controller) return
    if (props.disabled) throw new Error('当前文档只读，图片已保留，请恢复编辑后重试插入')

    const instance = editor.value
    if (!instance) throw new Error('图片已上传，但无法插入原位置')
    const displaySize = fitImageDisplaySize(
      naturalSize.width,
      naturalSize.height,
      imageAvailableWidth(instance),
    )
    task.displaySize = displaySize
    updateImageUploadPlaceholder(instance.view, task.id, displaySize)

    const imageDiffId = task.imageDiffId
    const previewUrl = task.previewUrl
    stageUploadedImageTransition(
      imageDiffId,
      previewUrl,
      () => revokeImagePreviewUrl(previewUrl),
    )
    task.previewHandedOff = true

    if (!slashCommands.insertImage(task.id, () => insertUploadedImage(task.id, asset, displaySize, imageDiffId))) {
      discardUploadedImageTransition(imageDiffId, false)
      task.previewHandedOff = false
      throw new Error('图片已上传，但无法插入原位置')
    }

    void uploadedImageAutoScroll.reveal(imageDiffId, instance.view.dom)
    finishImageUploadTask(task)
  } catch (error) {
    slashCommands.imageFinished(task.id)
    if (imageUploadTasks.get(task.id) !== task || controller.signal.aborted) return

    task.status = 'error'
    task.controller = undefined
    const message = imageUploadErrorMessage(error)
    if (!updateImageUploadPlaceholder(editor.value!.view, task.id, {
      status: 'error',
      errorMessage: message,
    })) {
      emit('error', message)
    }
    emitImageUploadState()
  }
}

async function uploadImageFile(task: ImageUploadTask, signal: AbortSignal) {
  if (!props.allowImageUpload) throw new Error('此编辑器不支持上传图片。')
  const draftId = await props.prepareImageUpload?.()
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const form = new FormData()
  if (task.file) form.append('file', task.file, task.uploadName)
  const query = new URLSearchParams()
  if (props.requirementId) query.set('requirementId', props.requirementId)
  if (draftId) { query.set('draftId', draftId); query.set('uploadId', task.id) }

  return await $fetch<UploadedImageAsset>(
    `/api/assets/upload?${query}`,
    {
      method: 'POST',
      body: form,
      signal,
      retry: 0,
    },
  )
}

function imageAvailableWidth(instance: Editor) {
  const surface = instance.view.dom
  const styles = window.getComputedStyle(surface)
  const horizontalPadding = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight)
  const contentWidth = surface.clientWidth - horizontalPadding
  return contentWidth > 0 ? contentWidth : 720
}

async function preloadUploadedImage(src: string, signal: AbortSignal) {
  return await new Promise<ImageDisplaySize>((resolve, reject) => {
    const image = new Image()
    let settled = false

    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', handleAbort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const handleAbort = () => {
      image.src = ''
      fail(new DOMException('Aborted', 'AbortError'))
    }

    image.onload = async () => {
      const naturalSize = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      }
      if (!naturalSize.width || !naturalSize.height) {
        fail(new Error('图片已上传，但无法加载预览'))
        return
      }

      try {
        await image.decode()
      } catch {
        // onload 已确认像素可用；部分浏览器仍可能拒绝重复 decode。
      }
      if (settled || signal.aborted) return

      settled = true
      cleanup()
      resolve(naturalSize)
    }
    image.onerror = () => fail(new Error('图片已上传，但无法加载预览'))
    signal.addEventListener('abort', handleAbort, { once: true })

    if (signal.aborted) {
      handleAbort()
      return
    }
    image.src = src
  })
}

function insertUploadedImage(
  taskId: string,
  asset: UploadedImageAsset,
  displaySize: ImageDisplaySize,
  imageDiffId: string,
) {
  const instance = editor.value
  if (!instance) return false

  const imagePresent = () => {
    let present = false
    instance.state.doc.descendants(node => {
      if (node.type.name === 'image' && node.attrs.diffId === imageDiffId && node.attrs.src === asset.url) present = true
    })
    return present
  }
  if (imagePresent()) {
    removeImageUploadPlaceholder(instance.view, taskId)
    return true
  }

  const position = findImageUploadPlaceholderPosition(instance.view, taskId)
  if (position === undefined) return false

  const inserted = instance
    .chain()
    .setMeta(DOCUMENT_LAYOUT_MOTION_META, false)
    .setMeta(imageUploadPlaceholderPluginKey, { type: 'insert', id: taskId, imageDiffId })
    .insertContentAt(
      position,
      {
        type: 'image',
        attrs: {
          src: asset.url,
          alt: asset.fileName,
          title: asset.fileName,
          width: displaySize.width,
          height: displaySize.height,
          align: 'center',
          diffId: imageDiffId,
        },
        content: [{ type: 'imageCaption' }],
      },
      { updateSelection: false },
    )
    .run()
  // 命令返回 true 也可能被事务守卫拒绝；确认正文中确实存在图片后才结束任务。
  if (!inserted || !imagePresent()) return false
  removeImageUploadPlaceholder(instance.view, taskId)
  return true
}

function imageUploadErrorMessage(error: unknown) {
  const candidate = error as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  const message = candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || ''
  if (message.includes('原图片') || message.includes('草稿')) return message
  if (message.includes('smaller than 5 MB')) return '图片大小不能超过 5 MB'
  if (message.includes('Only image uploads')) return '只能上传图片文件'
  if (message.includes('Failed to store') || message.includes('Failed to save')) {
    return '图片存储暂时不可用，请稍后重试'
  }
  if (message === '图片已上传，但无法加载预览') return '图片已上传，但暂时无法显示，请重试'
  if (message === '图片已上传，但无法插入原位置') return message
  return '上传未完成，请检查网络后重试'
}

function finishImageUploadTask(task: ImageUploadTask, removePlaceholder = false) {
  slashCommands.imageFinished(task.id)
  if (removePlaceholder && editor.value) {
    removeImageUploadPlaceholder(editor.value.view, task.id)
  }
  task.controller?.abort()
  if (!task.previewHandedOff) revokeImagePreviewUrl(task.previewUrl)
  imageUploadTasks.delete(task.id)
  emitImageUploadState()
}

function imageUploadActionId(event: Event) {
  return (event as CustomEvent<{ id?: string }>).detail?.id ?? ''
}

function retryImageUpload(event: Event) {
  const task = imageUploadTasks.get(imageUploadActionId(event))
  if (!task || task.status !== 'error' || !editor.value) return

  if (!updateImageUploadPlaceholder(editor.value.view, task.id, {
    status: 'uploading',
    errorMessage: undefined,
  })) {
    emit('error', '图片已保留，但无法找到插入位置')
    return
  }
  task.status = 'queued'
  emitImageUploadState()
  enqueueImageUpload(task.id)
}

function dismissImageUpload(event: Event) {
  const task = imageUploadTasks.get(imageUploadActionId(event))
  if (!task) return
  finishImageUploadTask(task, true)
}

function resolveImageUploadPreview(event: Event) {
  const detail = (event as CustomEvent<{
    id?: string
    naturalWidth?: number
    naturalHeight?: number
  }>).detail
  const task = detail?.id ? imageUploadTasks.get(detail.id) : undefined
  const instance = editor.value
  if (!task || !instance || !detail?.naturalWidth || !detail.naturalHeight) return

  const displaySize = fitImageDisplaySize(
    detail.naturalWidth,
    detail.naturalHeight,
    imageAvailableWidth(instance),
  )
  if (
    task.displaySize?.width === displaySize.width
    && task.displaySize.height === displaySize.height
  ) return

  task.displaySize = displaySize
  updateImageUploadPlaceholder(instance.view, task.id, displaySize)
}

function cancelAllImageUploads() {
  imageUploadTasks.forEach((task) => {
    task.controller?.abort()
    revokeImagePreviewUrl(task.previewUrl)
  })
  imageUploadTasks.clear()
  if (editor.value && !editor.value.isDestroyed) {
    clearImageUploadPlaceholders(editor.value.view)
  }
  emitImageUploadState()
}

function collectPreviewItems(document: RichTextDocument) {
  const items: PreviewItem[] = []

  const visit = (node: RichTextNode) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src) {
      const caption = node.content?.find((child) => child.type === 'imageCaption')
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '图片'
      const title = typeof node.attrs.title === 'string' ? node.attrs.title : alt
      items.push({
        diffId: typeof node.attrs.diffId === 'string' ? node.attrs.diffId : '',
        src: node.attrs.src,
        alt,
        caption: caption ? extractPlainText(caption) || undefined : undefined,
        downloadUrl: node.attrs.src,
        downloadName: title,
      })
    }

    node.content?.forEach(visit)
  }

  document.content.forEach(visit)
  return items
}

function openImagePreview(event: Event) {
  const detail = (event as CustomEvent<{ diffId?: string; src?: string }>).detail
  const index = previewItems.value.findIndex((item) =>
    detail?.diffId ? item.diffId === detail.diffId : item.src === detail?.src,
  )
  if (index < 0) return

  previewIndex.value = index
  previewOpen.value = true
}

interface ToolbarItem {
  label: string
  icon: Component
  active: boolean
  shortcut?: string
  type?: 'item' | 'checkbox'
  disabled?: boolean
  action: () => void
}

const selectionToolbarItems = computed<ToolbarItem[]>(() => [
  ...(props.annotations && canAnnotateSelection.value ? [{ label: '添加 AI 标注', icon: MessageSquareText, active: false, action: addAnnotation }] : []),
  {
    label: '加粗（Ctrl+B）',
    icon: Bold,
    active: isActive('bold'),
    action: () => run(() => editor.value!.chain().focus().toggleBold().run()),
  },
  {
    label: '斜体（Ctrl+I）',
    icon: Italic,
    active: isActive('italic'),
    action: () => run(() => editor.value!.chain().focus().toggleItalic().run()),
  },
  {
    label: '删除线',
    icon: Strikethrough,
    active: isActive('strike'),
    action: () => run(() => editor.value!.chain().focus().toggleStrike().run()),
  },
  {
    label: '高亮',
    icon: Highlighter,
    active: isActive('highlight'),
    action: () => run(() => editor.value!.chain().focus().toggleHighlight().run()),
  },
  ...(props.allowSelectionHistory ? [{
    label: '查看选区历史',
    icon: History,
    active: false,
    action: openSelectionHistory,
  }] : []),
])

const toolbarGroups = computed<ToolbarItem[][]>(() => editorFormatGroups.map(group => group.map(item => ({
  label: item.label, icon: item.icon, shortcut: item.shortcut,
  active: isActive(item.name, item.attrs),
  action: () => run(() => item.command(editor.value!.chain().focus()).run()),
}))))

const insertToolbarItems = computed<ToolbarItem[]>(() => [
  ...(props.allowImageUpload ? [{ label: '图片', icon: ImageIcon, active: false, action: pickImage }] : []),
  {
    label: '代码块', icon: CodeXml, active: isActive('codeBlock'),
    action: () => run(() => editor.value!.chain().focus().toggleCodeBlock().run()),
  },
])

const extraToolbarItems = computed<ToolbarItem[]>(() => [
  {
    label: '撤销（Ctrl+Z）', icon: Undo2, active: false, disabled: !canUndo.value,
    action: () => run(() => editor.value!.chain().focus().undo().run()),
  },
  {
    label: '重做（Ctrl+Y）', icon: Redo2, active: false, disabled: !canRedo.value,
    action: () => run(() => editor.value!.chain().focus().redo().run()),
  },
  {
    label: '高亮', icon: Highlighter, type: 'checkbox', active: isActive('highlight'),
    action: () => run(() => editor.value!.chain().focus().toggleHighlight().run()),
  },
])

onBeforeUnmount(() => {
  detachReadingAnchor?.()
  disposingUploads = true
  detachDocumentLayoutMotion?.()
  detachDocumentLayoutMotion = null
  cancelAllImageUploads()
})
</script>

<template>
  <section ref="editorRoot" class="requirement-editor" :class="{ 'requirement-editor--disabled': disabled, 'requirement-editor--no-outline': hideOutline || externalOutline, 'requirement-editor--chapter-links': !!requirementId }">
    <div class="requirement-editor__layout">
      <RequirementOutline
        v-if="!externalOutline"
        v-show="!hideOutline"
        :items="requirementOutline.items.value"
        :active-ids="requirementOutline.activeIds.value"
        :viewport-height="editorViewportHeight"
        :header-height="editorToolbarHeight"
        @select="requirementOutline.scrollToHeading"
      >
        <template v-if="$slots.navigation" #navigation><slot name="navigation" /></template>
      </RequirementOutline>

      <div class="requirement-editor__main">
        <div ref="editorToolbar" class="requirement-editor__toolbar" aria-label="编辑器工具栏">
          <div v-if="$slots['compact-navigation']" class="requirement-editor__compact-navigation"><slot name="compact-navigation" /></div>
          <RequirementEditorToolbarControls :groups="toolbarGroups" :disabled="disabled || !editor">
      <template #insert>
        <RequirementLinkMenu
          v-model:open="toolbarLinkMenuOpen"
          :href="linkCommandState.href"
          :selected-text="linkCommandState.selectedText"
          :has-selection="linkCommandState.hasSelection"
          :active="linkCommandState.active"
          :disabled="!linkCommandState.canOpen"
          @apply="applyLink"
          @remove="removeLink"
        />
        <BingDropDown
          v-model:open="tableMenuOpen"
          trigger="click"
          placement="bottom-start"
          size="sm"
          :min-width="248"
          :max-width="272"
          panel-class="requirement-editor__table-panel"
          aria-label="表格工具"
          @open="resetTableGridSize"
        >
          <template #trigger="{ open, triggerProps }">
            <BingTooltip content="表格" placement="bottom">
              <BingButton
                v-bind="triggerProps"
                class="requirement-editor__tool"
                :class="{
                  'requirement-editor__tool--active': open || tableCommandState.active,
                }"
                size="sm"
                variant="ghost"
                rounded="sm"
                :disabled="disabled || !editor"
                :aria-label="open ? '关闭表格工具' : '打开表格工具'"
              >
                <template #prefix>
                  <BingIcon :icon="Table2" :size="16" decorative />
                </template>
              </BingButton>
            </BingTooltip>
          </template>

          <div v-if="!tableCommandState.active" class="requirement-editor__table-picker">
            <div class="requirement-editor__table-picker-heading">
              <span>插入表格</span>
              <span>{{ tableGridColumns }} 列 × {{ tableGridRows }} 行</span>
            </div>
            <div class="requirement-editor__table-grid" role="grid" aria-label="选择新表格的列数和行数">
              <button
                v-for="cell in tableGridCells"
                :key="`${cell.row}-${cell.column}`"
                class="requirement-editor__table-grid-cell"
                :class="{
                  'requirement-editor__table-grid-cell--selected':
                    cell.row <= tableGridRows && cell.column <= tableGridColumns,
                }"
                type="button"
                role="gridcell"
                :aria-label="`插入 ${cell.column} 列 ${cell.row} 行表格`"
                :aria-selected="cell.row <= tableGridRows && cell.column <= tableGridColumns"
                :disabled="!tableCommandState.canInsert"
                @mouseenter="selectTableGridSize(cell.row, cell.column)"
                @focus="selectTableGridSize(cell.row, cell.column)"
                @click="insertTable(cell.row, cell.column)"
              />
            </div>
          </div>
          <div v-else class="requirement-editor__table-context">
            <BingIcon :icon="Table2" :size="17" decorative />
            <span>
              <strong>编辑表格</strong>
              <small>以当前单元格为基准</small>
            </span>
          </div>

          <div class="requirement-editor__context-separator" role="separator" />

          <BingDropDownItem
            title="列"
            description="在当前列左右插入或删除"
            :icon="Columns3"
            :disabled="!tableCommandState.active"
            :close-on-click="false"
          >
            <template #submenu>
              <BingDropDownItem
                title="在左侧插入列"
                :icon="BetweenVerticalStart"
                :disabled="!tableCommandState.canAddColumnBefore"
                @click="run(() => editor!.chain().focus().addColumnBefore().run())"
              />
              <BingDropDownItem
                title="在右侧插入列"
                :icon="BetweenVerticalEnd"
                :disabled="!tableCommandState.canAddColumnAfter"
                @click="run(() => editor!.chain().focus().addColumnAfter().run())"
              />
              <div class="requirement-editor__context-separator" role="separator" />
              <BingDropDownItem
                title="删除当前列"
                tone="danger"
                :icon="Trash2"
                :disabled="!tableCommandState.canDeleteColumn"
                @click="run(() => editor!.chain().focus().deleteColumn().run())"
              />
            </template>
          </BingDropDownItem>
          <BingDropDownItem
            title="行"
            description="在当前行上下插入或删除"
            :icon="Rows3"
            :disabled="!tableCommandState.active"
            :close-on-click="false"
          >
            <template #submenu>
              <BingDropDownItem
                title="在上方插入行"
                :icon="BetweenHorizontalStart"
                :disabled="!tableCommandState.canAddRowBefore"
                @click="run(() => editor!.chain().focus().addRowBefore().run())"
              />
              <BingDropDownItem
                title="在下方插入行"
                :icon="BetweenHorizontalEnd"
                :disabled="!tableCommandState.canAddRowAfter"
                @click="run(() => editor!.chain().focus().addRowAfter().run())"
              />
              <div class="requirement-editor__context-separator" role="separator" />
              <BingDropDownItem
                title="删除当前行"
                tone="danger"
                :icon="Trash2"
                :disabled="!tableCommandState.canDeleteRow"
                @click="run(() => editor!.chain().focus().deleteRow().run())"
              />
            </template>
          </BingDropDownItem>
          <BingDropDownItem
            title="切换首行为表头"
            :icon="PanelTop"
            :disabled="!tableCommandState.canToggleHeaderRow"
            @click="run(() => editor!.chain().focus().toggleHeaderRow().run())"
          />

          <div class="requirement-editor__context-separator" role="separator" />

          <BingDropDownItem
            title="删除整张表格"
            tone="danger"
            :icon="Trash2"
            :disabled="!tableCommandState.canDeleteTable"
            @click="run(() => editor!.chain().focus().deleteTable().run())"
          />
        </BingDropDown>
        <BingTooltip v-for="item in insertToolbarItems" :key="item.label" :content="item.label" placement="bottom">
          <BingButton class="requirement-editor__tool" :class="{ 'requirement-editor__tool--active': item.active }" size="sm" variant="ghost" rounded="sm" :disabled="disabled || !editor" :aria-label="item.label" @click="item.action">
            <BingIcon :icon="item.icon" :size="16" decorative />
          </BingButton>
        </BingTooltip>
      </template>

          <template #extra>
            <BingTooltip v-if="allowSelectionHistory" :content="hasSelection ? '查看选区历史' : '查看当前块历史'" placement="bottom">
              <BingButton class="requirement-editor__tool" variant="ghost" size="sm" :aria-label="hasSelection ? '查看选区历史' : '查看当前块历史'" :disabled="disabled || !editor" @click="openSelectionHistory"><BingIcon :icon="History" :size="16" decorative /></BingButton>
            </BingTooltip>
            <BingTooltip v-if="annotations" content="选中文字，添加 AI 标注" placement="bottom">
              <BingButton class="requirement-editor__tool" variant="ghost" size="sm" aria-label="添加 AI 标注" :disabled="!canAnnotateSelection" @mousedown.prevent @click="addAnnotation"><BingIcon :icon="MessageSquarePlus" :size="16" decorative /></BingButton>
            </BingTooltip>
            <BingDropDown trigger="click" aria-label="更多格式工具">
              <template #trigger="{ triggerProps }">
                <BingButton v-bind="triggerProps" class="requirement-editor__tool" variant="ghost" size="sm" aria-label="更多格式工具" :disabled="disabled || !editor"><BingIcon :icon="Ellipsis" :size="16" decorative /></BingButton>
              </template>
              <BingDropDownItem v-for="item in extraToolbarItems" :key="item.label" :title="item.label" :icon="item.icon" :type="item.type" :checked="item.active" :disabled="disabled || item.disabled" @click="item.action" />
              <BingDropDownItem title="组件块" :icon="MessageSquarePlus" :disabled="disabled">
                <template #submenu>
                  <CalloutToneItems v-if="editor?.can().insertCallout()" @select="insertCallout" />
                  <BingDropDownItem title="折叠块" :icon="ChevronDown" :disabled="!editor?.can().setDetails()" @click="run(() => editor!.chain().focus().setDetails().run())" />
                  <BingDropDownItem v-if="isActive('details')" title="取消折叠块" :icon="Pilcrow" @click="run(() => editor!.chain().focus().unsetDetails().run())" />
                </template>
              </BingDropDownItem>
            </BingDropDown>
          </template>
          <input v-if="allowImageUpload" ref="uploadInput" class="requirement-editor__upload" type="file" accept="image/*" @change="uploadImage" @cancel="slashCommands.close()" />
          </RequirementEditorToolbarControls>
          <div v-if="$slots.actions" class="requirement-editor__workspace-actions"><slot name="actions" /></div>
        </div>

        <RequirementSlashMenu v-if="editor && active !== false" :editor="editor" :state="slashMenu"
          :get-viewport="() => editorScrollbar?.viewport" @close="slashCommands.close" @select="slashCommands.select" @move="slashCommands.move" />
        <BingDropDown
          v-model:open="editorContextOpen"
          trigger="contextmenu"
          size="sm"
          block
          :min-width="248"
          :max-width="292"
          panel-class="requirement-editor__context-panel"
          :aria-label="editorContextMenuAriaLabel"
        >
      <template #trigger="{ triggerProps }">
        <BingScrollbar
          ref="editorScrollbar"
          class="requirement-editor__scroll"
          :height="editorViewportHeight"
          :style="editorScrollStyle"
          smooth
          aria-label="文档正文"
        >
          <div v-if="$slots.heading" class="requirement-editor__document-heading"><slot name="heading" /></div>
          <div
            ref="contextSurface"
            v-bind="triggerProps"
            class="requirement-editor__content"
            @pointerdown.capture="selectionMenuPointer.handlePointerDown"
            @mousedown.capture="handleEditorContextMouseDown"
            @contextmenu.capture="handleEditorContextMenu"
            @keydown.capture="handleContextKeyboard"
            @requirement-image-preview="openImagePreview"
            @requirement-image-upload-preview-ready="resolveImageUploadPreview"
            @requirement-image-upload-retry="retryImageUpload"
            @requirement-image-upload-dismiss="dismissImageUpload"
          >
            <EditorContent v-if="editor" :editor="editor" />
            <RequirementChapterLinks v-if="editor && requirementId" ref="chapterLinks" :requirement-id="requirementId" :editor="editor"
              :active="active !== false" :get-viewport="() => editorScrollbar?.viewport" />
            <RequirementVersionMarkers v-if="editor && versionNumber && versionMarkers" ref="versionOverlay"
              :editor="editor" :markers="versionMarkers" :version="versionNumber" :active="active !== false"
              :pending="!!versionPending" :read-only="versionReadOnly ?? disabled" :restore-disabled-reason="versionRestoreDisabledReason"
              :compare-disabled="versionCompareDisabled"
              :get-scroll-controller="() => editorScrollbar" @open="setSelectionMenuMeta('hide')"
              @restore="restoreVersionMarker" @compare="emit('compare-version-change', $event)" />
            <RequirementAnnotationOverlay v-if="editor && annotations" ref="annotationOverlay" :editor="editor" :annotations="annotations"
              :version-gutter="!!versionNumber && !!versionMarkers?.length"
              :active="active !== false" :active-id="activeAnnotationId" :get-scroll-controller="() => editorScrollbar"
              :draft="annotationDraft" :comment="annotationComment" :error="annotationError"
              @select="emit('select-annotation', $event)" @update:comment="emit('update:annotationComment', $event)"
              @save="emit('save-annotation')" @cancel="emit('cancel-annotation')" />

            <BubbleMenu
              v-if="editor"
              :editor="editor"
              :plugin-key="SELECTION_MENU_PLUGIN_KEY"
              :update-delay="SELECTION_MENU_UPDATE_DELAY"
              :should-show="shouldShowSelectionMenu"
              :options="{
                placement: 'top',
                offset: 10,
                flip: true,
                shift: { padding: 12 },
                onShow: selectionMenuMotion.prepareEntrance,
                onUpdate: selectionMenuMotion.playEntrance,
                onHide: selectionMenuMotion.playExit,
              }"
              class="requirement-editor__selection-menu"
              role="toolbar"
              aria-label="文本快捷格式"
            >
              <div ref="selectionMenuItemsRoot" class="requirement-editor__selection-menu-items">
                <BingTooltip
                  v-for="item in selectionToolbarItems"
                  :key="item.label"
                  :content="item.label"
                  placement="top"
                >
                  <BingButton
                    class="requirement-editor__selection-tool"
                    :class="{ 'requirement-editor__selection-tool--active': item.active }"
                    size="sm"
                    variant="ghost"
                    rounded="sm"
                    :aria-label="item.label"
                    @mousedown.prevent
                    @click="item.action"
                  >
                    <template #prefix>
                      <BingIcon :icon="item.icon" :size="15" decorative />
                    </template>
                  </BingButton>
                </BingTooltip>

                <RequirementLinkMenu
                  v-model:open="selectionLinkMenuOpen"
                  surface="selection"
                  :href="linkCommandState.href"
                  :selected-text="linkCommandState.selectedText"
                  :has-selection="linkCommandState.hasSelection"
                  :active="linkCommandState.active"
                  :disabled="!linkCommandState.canOpen"
                  @apply="applyLink"
                  @remove="removeLink"
                />
              </div>
            </BubbleMenu>
          </div>
        </BingScrollbar>
      </template>

      <BingDropDownItem v-if="contextVersionMarker" title="查看此块修改" :icon="History" :disabled="versionPending" @click="openContextVersionChange" />
      <BingDropDownItem v-if="contextChapterId" title="复制章节链接" :icon="LinkIcon" @click="copyContextChapter" />
      <BingDropDownItem v-if="contextCalloutId && !disabled" title="切换提示类型" :icon="MessageSquareText">
        <template #submenu><CalloutToneItems :current="contextCalloutTone" @select="switchContextCallout" /></template>
      </BingDropDownItem>
      <template v-if="annotations && objectAnnotationTargets.length">
        <BingDropDownItem v-for="(target, index) in objectAnnotationTargets" :key="target.blockId" :icon="MessageSquarePlus"
          :title="objectTargetPresentation(target, index > 0).menu"
          :description="objectTargetPresentation(target).description" @click="addObjectAnnotation(target)" />
        <div class="requirement-editor__context-separator" role="separator" />
      </template>
      <template v-if="editorContextTarget.kind === 'table'">
        <div class="requirement-editor__context-identity">
          <span class="requirement-editor__context-identity-icon">
            <BingIcon :icon="Table2" :size="16" decorative />
          </span>
          <span>
            <strong>表格</strong>
            <small>{{ editorContextMenuLabel }}</small>
          </span>
        </div>
        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="左侧插入列"
          :icon="BetweenVerticalStart"
          :disabled="!tableCommandState.canAddColumnBefore"
          @click="run(() => editor!.chain().focus().addColumnBefore().run())"
        />
        <BingDropDownItem
          title="右侧插入列"
          :icon="BetweenVerticalEnd"
          :disabled="!tableCommandState.canAddColumnAfter"
          @click="run(() => editor!.chain().focus().addColumnAfter().run())"
        />
        <BingDropDownItem
          title="上方插入行"
          :icon="BetweenHorizontalStart"
          :disabled="!tableCommandState.canAddRowBefore"
          @click="run(() => editor!.chain().focus().addRowBefore().run())"
        />
        <BingDropDownItem
          title="下方插入行"
          :icon="BetweenHorizontalEnd"
          :disabled="!tableCommandState.canAddRowAfter"
          @click="run(() => editor!.chain().focus().addRowAfter().run())"
        />

        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="切换首行为表头"
          :icon="PanelTop"
          :disabled="!tableCommandState.canToggleHeaderRow"
          @click="run(() => editor!.chain().focus().toggleHeaderRow().run())"
        />

        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="删除当前行"
          tone="danger"
          :icon="Rows3"
          :disabled="!tableCommandState.canDeleteRow"
          @click="run(() => editor!.chain().focus().deleteRow().run())"
        />
        <BingDropDownItem
          title="删除当前列"
          tone="danger"
          :icon="Columns3"
          :disabled="!tableCommandState.canDeleteColumn"
          @click="run(() => editor!.chain().focus().deleteColumn().run())"
        />
        <BingDropDownItem
          title="删除整张表格"
          tone="danger"
          :icon="Trash2"
          :disabled="!tableCommandState.canDeleteTable"
          @click="run(() => editor!.chain().focus().deleteTable().run())"
        />
      </template>

      <template v-else-if="editorContextTarget.kind === 'image'">
        <div class="requirement-editor__context-identity">
          <span class="requirement-editor__context-identity-icon">
            <BingIcon :icon="ImageIcon" :size="16" decorative />
          </span>
          <span>
            <strong>图片</strong>
            <small>{{ editorContextMenuLabel }}</small>
          </span>
        </div>
        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem title="预览图片" :icon="Eye" @click="previewContextImage" />
        <BingDropDownItem
          title="图片居左"
          :icon="TextAlignStart"
          type="radio" :checked="imageContextCommandState.alignment === 'left'"
          :disabled="!imageContextCommandState.canUpdate"
          @click="setContextImageAlignment('left')"
        />
        <BingDropDownItem
          title="图片居中"
          :icon="TextAlignCenter"
          type="radio" :checked="imageContextCommandState.alignment === 'center'"
          :disabled="!imageContextCommandState.canUpdate"
          @click="setContextImageAlignment('center')"
        />
        <BingDropDownItem
          title="图片居右"
          :icon="TextAlignEnd"
          type="radio" :checked="imageContextCommandState.alignment === 'right'"
          :disabled="!imageContextCommandState.canUpdate"
          @click="setContextImageAlignment('right')"
        />

        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="删除图片"
          tone="danger"
          :icon="Trash2"
          :disabled="!imageContextCommandState.canDelete"
          @click="deleteContextImage"
        />
      </template>

      <template v-else-if="editorContextTarget.kind === 'link'">
        <div class="requirement-editor__context-identity">
          <span class="requirement-editor__context-identity-icon">
            <BingIcon :icon="LinkIcon" :size="16" decorative />
          </span>
          <span>
            <strong>{{ editorContextMenuLabel }}</strong>
            <small>{{ editorContextLinkHref }}</small>
          </span>
        </div>
        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem title="打开链接" :icon="ExternalLink" @click="openContextLink" />
        <BingDropDownItem title="复制链接" :icon="Copy" @click="copyContextLink" />
        <BingDropDownItem v-if="allowSelectionHistory" title="查看选区历史" :icon="History" @click="openSelectionHistory" />
        <BingDropDownItem
          title="移除链接"
          tone="danger"
          :icon="Unlink2"
          :disabled="disabled || !linkCommandState.active"
          @click="removeLink"
        />
      </template>

      <template v-else>
        <BingDropDownItem
          title="撤销"
          :icon="Undo2"
          shortcut="Ctrl+Z"
          :disabled="!canUndo"
          @click="run(() => editor!.chain().focus().undo().run())"
        />
        <BingDropDownItem
          title="重做"
          :icon="Redo2"
          shortcut="Ctrl+Y"
          :disabled="!canRedo"
          @click="run(() => editor!.chain().focus().redo().run())"
        />

        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="剪切"
          :icon="Scissors"
          shortcut="Ctrl+X"
          :disabled="!hasSelection"
          @click="cutSelection"
        />
        <BingDropDownItem
          title="复制"
          :icon="Copy"
          shortcut="Ctrl+C"
          :disabled="!hasSelection"
          @click="copySelection"
        />
        <BingDropDownItem
          title="粘贴纯文本"
          :icon="ClipboardPaste"
          shortcut="Ctrl+Shift+V"
          :disabled="!canPastePlainText"
          @click="pastePlainText"
        />
        <BingDropDownItem
          title="全选"
          :icon="TextSelect"
          shortcut="Ctrl+A"
          :disabled="disabled || !editor"
          @click="run(() => editor!.commands.selectAll())"
        />

        <BingDropDownItem
          v-if="allowSelectionHistory"
          :title="hasSelection ? '查看选区历史' : '查看当前块历史'"
          :icon="History"
          :disabled="disabled || !editor"
          @click="openSelectionHistory"
        />

        <div class="requirement-editor__context-separator" role="separator" />

        <BingDropDownItem
          title="转换为"
          :icon="Pilcrow"
          :active="
            isActive('heading') ||
            isActive('bulletList') ||
            isActive('orderedList') ||
            isActive('taskList') ||
            isActive('blockquote') ||
            isActive('codeBlock')
          "
          :disabled="disabled || !editor"
          :close-on-click="false"
        >
          <template #submenu>
          <BingDropDownItem
            title="正文"
            :icon="Pilcrow"
            type="radio" :checked="isActive('paragraph')"
            @click="run(() => editor!.chain().focus().setParagraph().run())"
          />
          <BingDropDownItem
            title="一级标题"
            :icon="Heading1"
            type="radio" :checked="isActive('heading', { level: 1 })"
            @click="run(() => editor!.chain().focus().setHeading({ level: 1 }).run())"
          />
          <BingDropDownItem
            title="二级标题"
            :icon="Heading2"
            type="radio" :checked="isActive('heading', { level: 2 })"
            @click="run(() => editor!.chain().focus().setHeading({ level: 2 }).run())"
          />
          <BingDropDownItem
            title="三级标题"
            :icon="Heading3"
            type="radio" :checked="isActive('heading', { level: 3 })"
            @click="run(() => editor!.chain().focus().setHeading({ level: 3 }).run())"
          />
          <BingDropDownItem
            title="无序列表"
            :icon="List"
            type="checkbox" :checked="isActive('bulletList')"
            @click="run(() => editor!.chain().focus().toggleBulletList().run())"
          />
          <BingDropDownItem
            title="有序列表"
            :icon="ListOrdered"
            type="checkbox" :checked="isActive('orderedList')"
            @click="run(() => editor!.chain().focus().toggleOrderedList().run())"
          />
          <BingDropDownItem
            title="任务清单"
            :icon="ListTodo"
            type="checkbox" :checked="isActive('taskList')"
            @click="run(() => editor!.chain().focus().toggleTaskList().run())"
          />
          <BingDropDownItem
            title="引用"
            :icon="Quote"
            type="checkbox" :checked="isActive('blockquote')"
            @click="run(() => editor!.chain().focus().toggleBlockquote().run())"
          />
          <BingDropDownItem
            title="代码块"
            :icon="CodeXml"
            type="checkbox" :checked="isActive('codeBlock')"
            @click="run(() => editor!.chain().focus().toggleCodeBlock().run())"
          />
          </template>
        </BingDropDownItem>
        <BingDropDownItem
          title="清除格式"
          :icon="RemoveFormatting"
          :disabled="disabled || !editor"
          @click="run(() => editor!.chain().focus().unsetAllMarks().clearNodes().run())"
        />
      </template>
        </BingDropDown>
      </div>

    </div>

    <BingDialog :model-value="Boolean(annotationEditIds)" title="修改标注原文" :width="400" :aria-describedby="annotationEditHintId"
      cancel-text="取消" confirm-text="确认" :show-peek="false" :close-on-overlay="false"
      @update:model-value="open => { if (!open) annotationEditGuard.cancel() }" @confirm="annotationEditGuard.confirm()">
      <p :id="annotationEditHintId">{{ annotationEditIds && annotationEditIds.length > 1
        ? `如果继续输入会清除这 ${annotationEditIds.length} 个标注，你确认吗？`
        : '如果继续输入会清除这个标注，你确认吗？' }}</p>
    </BingDialog>

    <BingImagePreview
      v-model="previewOpen"
      v-model:current-index="previewIndex"
      :items="previewItems"
      :initial-index="previewIndex"
      downloadable
      loop
      aria-label="文档图片预览"
    />
  </section>
</template>
