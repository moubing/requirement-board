import { createApp, Fragment, h, nextTick, ref, shallowRef, type App } from 'vue'
import { BingCursor, BingToast, bingToast } from '@moubing/bing-ui'
import type { Editor } from '@tiptap/core'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin } from '@tiptap/pm/state'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import RichRequirementEditor from '../../app/components/editor/RichRequirementEditor.vue'
import RichTextRevisionViewer from '../../app/components/revision/RichTextRevisionViewer.vue'
import { collaborationSnapshotSchema, createCollaborationDocument, ensureCollaborationTrailingParagraph, readCollaborationDocument } from '../../shared/collaboration/document'
import { applyCandidateToYDocument } from '../../shared/agent/collaboration'
import { ensureBlockIds, type RichTextDocument } from '../../shared/editor/document'
import { sameRichTextContent } from '../../shared/editor/content-equality'
import { buildRichTextDiff } from '../../shared/diff/rich-text-diff'
import { useContentModified } from '../../app/composables/use-content-modified'
import { normalizeTrailingParagraph } from '../../shared/editor/trailing-paragraph'
import type { LocalImageUpload } from '../../shared/drafts/document'
import { imageUploadPlaceholderPluginKey } from '../../app/components/editor/image-upload-placeholder'
import '@moubing/bing-ui/style.css'
import '../../app/assets/css/main.css'
import '../../app/assets/css/shell.css'
import '../../app/assets/css/editor-workspace.css'
import '../../app/assets/css/preferences.css'

let app: App | undefined
let doc: Y.Doc | undefined
let awareness: Awareness | undefined
const errors: string[] = []
const active = ref(true)
const disabled = ref(false)
const editor = () => (document.querySelector('.tiptap') as HTMLElement & { editor: Editor }).editor

const fixture = {
  editor,
  errors,
  modelUpdates: 0,
  localUpdates: 0,
  uploadState: { uploading: 0, failed: 0 },
  uploadCheckpoint: [] as LocalImageUpload[],
  setActive(value: boolean) { active.value = value },
  setDisabled(value: boolean) { disabled.value = value },
  clearToasts: () => bingToast.clear(),
  rejectNextUploadInsertion() {
    let rejected = false
    editor().registerPlugin(new Plugin({
      filterTransaction(transaction) {
        if (rejected || transaction.getMeta(imageUploadPlaceholderPluginKey)?.type !== 'insert') return true
        rejected = true
        return false
      },
    }))
  },
  collaborationSnapshot() {
    return collaborationSnapshotSchema.parse(readCollaborationDocument(doc!))
  },
  collaborationState: () => Array.from(Y.encodeStateAsUpdate(doc!)),
  receiveState(state: number[]) { Y.applyUpdate(doc!, Uint8Array.from(state)) },
  normalizeContent(content: RichTextDocument) { return normalizeTrailingParagraph(ensureBlockIds(structuredClone(content))) },
  compareContent(content: RichTextDocument) {
    const baseline = editor().schema.nodeFromJSON(content).toJSON() as RichTextDocument
    const current = editor().getJSON() as RichTextDocument
    return { modified: !sameRichTextContent(baseline, current), counts: buildRichTextDiff(baseline, current).counts }
  },
  mergeIndependentHistory() {
    const duplicate = createCollaborationDocument(readCollaborationDocument(doc!))
    try { Y.applyUpdate(doc!, Y.encodeStateAsUpdate(duplicate)) }
    finally { duplicate.destroy() }
  },
  applySuggestion(content: RichTextDocument) {
    const remote = new Y.Doc()
    const candidate = createCollaborationDocument({ title: '编辑器测试', contentJson: normalizeTrailingParagraph(structuredClone(content)) })
    try {
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc!))
      applyCandidateToYDocument(remote, readCollaborationDocument(candidate))
      Y.applyUpdate(doc!, Y.encodeStateAsUpdate(remote))
    } finally { candidate.destroy(); remote.destroy() }
  },
  separateHistory() {
    const instance = editor()
    const manager = yUndoPluginKey.getState(instance.state)?.undoManager
    if (manager) manager.stopCapturing()
    else instance.view.dispatch(closeHistory(instance.state.tr))
  },
  async mountRevision(content: RichTextDocument, requirementId?: string) {
    app?.unmount()
    awareness?.destroy()
    doc?.destroy()
    app = createApp({ render: () => h(Fragment, [h(BingToast), h(RichTextRevisionViewer, { document: content, requirementId })]) })
    app.mount('#app')
    await nextTick()
  },
  async mount(collaborative: boolean, content: RichTextDocument, options: { disabled?: boolean; state?: number[]; versionBase?: RichTextDocument; requirementId?: string } = {}) {
    app?.unmount()
    active.value = true
    disabled.value = options.disabled ?? false
    fixture.modelUpdates = 0
    fixture.localUpdates = 0
    fixture.uploadState = { uploading: 0, failed: 0 }
    fixture.uploadCheckpoint = []
    bingToast.clear()
    awareness?.destroy()
    doc?.destroy()
    const value = shallowRef(ensureBlockIds(structuredClone(content)))
    if (options.state) {
      doc = new Y.Doc()
      Y.applyUpdate(doc, Uint8Array.from(options.state))
    } else {
      doc = createCollaborationDocument({ title: '编辑器测试', contentJson: value.value })
      // 对应服务端新建共同文档；已有二进制状态直接恢复。
      ensureCollaborationTrailingParagraph(doc)
    }
    if (collaborative) value.value = readCollaborationDocument(doc).contentJson
    doc.on('update', (_update, _origin, _doc, transaction) => {
      if (transaction.local) fixture.localUpdates++
    })
    awareness = new Awareness(doc)
    const collaboration = collaborative ? {
      document: doc, provider: { awareness }, user: { id: 'browser-test', name: '测试成员', color: '#3366cc' },
    } : undefined
    app = createApp({
      setup: () => {
        const changes = useContentModified(value, shallowRef(options.versionBase ?? null), ref(true), { active: () => active.value, markers: () => !!options.versionBase })
        return () => h(Fragment, [h(BingCursor, { global: true }), h(BingToast), h(RichRequirementEditor, {
        modelValue: value.value,
        requirementId: options.requirementId,
        active: active.value,
        disabled: disabled.value,
        versionComparison: changes.comparison.value,
        versionMarkers: options.versionBase ? changes.markers.value : undefined,
        versionNumber: options.versionBase ? 1 : undefined,
        versionPending: changes.modified.value === null,
        'onUpdate:modelValue': (next: RichTextDocument) => { fixture.modelUpdates++; value.value = next },
        onError: (error: string) => errors.push(error),
        onImageUploadState: (state: { uploading: number, failed: number }) => { fixture.uploadState = state },
        onUploadCheckpoint: (uploads: LocalImageUpload[]) => { fixture.uploadCheckpoint = uploads },
        hideOutline: true,
        collaboration: collaboration as never,
      })]) },
    })
    app.mount('#app')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 30))
  },
}

declare global {
  interface Window { editorFixture: typeof fixture }
}
window.editorFixture = fixture
