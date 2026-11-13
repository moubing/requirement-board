<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import RequirementChapterLinks from '../editor/RequirementChapterLinks.vue'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { ScrollbarCodeBlock, ScrollbarTableView } from '../editor/scrollbar-node-views'
import { EditableTaskItem, RequirementTaskList } from '../editor/task-list-extension'
import { EditableDetails, EditableDetailsContent, RequirementDetailsSummary } from '../editor/details-extension'
import { TABLE_MIN_COLUMN_WIDTH } from '~~/shared/editor/table-columns'
import Typography from '@tiptap/extension-typography'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import {
  BingImagePreview,
  type BingImagePreviewItem,
} from '@moubing/bing-ui'

import {
  cloneRichTextDocument,
  ensureBlockIds,
  extractPlainText,
  type RichTextDocument,
  type RichTextNode,
} from '~~/shared/editor/document'
import {
  BlockId,
  Callout,
  ImageCaption,
  RequirementImage,
} from '../editor/tiptap-extensions'

const props = withDefaults(defineProps<{
  document: RichTextDocument
  requirementId?: string
  label?: string
}>(), { label: '历史版本正文（只读）' })

type PreviewItem = BingImagePreviewItem & { diffId: string }

function normalizeDocument(document: RichTextDocument) {
  return ensureBlockIds(cloneRichTextDocument(document))
}

function collectPreviewItems(document: RichTextDocument): PreviewItem[] {
  const items: PreviewItem[] = []

  function visit(node: RichTextNode) {
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

const normalizedDocument = computed(() => normalizeDocument(props.document))
const previewItems = computed(() => collectPreviewItems(normalizedDocument.value))
const previewOpen = ref(false)
const previewIndex = ref(0)

const editor = useEditor({
  content: normalizedDocument.value,
  editable: false,
  extensions: [
    StarterKit.configure({
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
      enableClickSelection: false,
      autolink: false,
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
    TableKit.configure({ table: { View: ScrollbarTableView, cellMinWidth: TABLE_MIN_COLUMN_WIDTH } }),
    BlockId,
    Callout,
  ],
  editorProps: {
    attributes: {
      class: 'requirement-editor__surface requirement-revision-viewer__surface',
      role: 'document',
      'aria-label': props.label,
      'data-readonly': 'true',
    },
  },
})

watch(
  () => props.document,
  (document) => {
    editor.value?.commands.setContent(normalizeDocument(document), { emitUpdate: false })
    previewOpen.value = false
    previewIndex.value = 0
  },
)

function openImagePreview(event: Event) {
  const detail = (event as CustomEvent<{ diffId?: string; src?: string }>).detail
  const index = previewItems.value.findIndex((item) =>
    detail?.diffId ? item.diffId === detail.diffId : item.src === detail?.src,
  )
  if (index < 0) return

  previewIndex.value = index
  previewOpen.value = true
}
</script>

<template>
  <div
    class="requirement-revision-viewer"
    :class="{ 'requirement-editor--chapter-links': !!requirementId }"
    data-readonly="true"
    @requirement-image-preview="openImagePreview"
  >
    <EditorContent v-if="editor" :editor="editor" />
    <RequirementChapterLinks v-if="editor && requirementId" :editor="editor" :requirement-id="requirementId" />

    <BingImagePreview
      v-model="previewOpen"
      v-model:current-index="previewIndex"
      :items="previewItems"
      :initial-index="previewIndex"
      downloadable
      loop
      aria-label="历史版本图片预览"
    />
  </div>
</template>
