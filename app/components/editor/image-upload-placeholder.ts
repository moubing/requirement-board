import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'

export type ImageUploadPlaceholderStatus = 'uploading' | 'error'

export interface ImageUploadPlaceholderData {
  id: string
  fileName: string
  previewUrl?: string
  width?: number
  height?: number
  status: ImageUploadPlaceholderStatus
  errorMessage?: string
  order: number
  relativePosition?: string
}

export type ImageUploadPlaceholderPatch = Partial<
  Pick<ImageUploadPlaceholderData, 'width' | 'height' | 'status' | 'errorMessage'>
>

interface ImageUploadPlaceholderSpec extends ImageUploadPlaceholderData {
  kind: 'image-upload-placeholder'
  renderVersion: number
}

type ImageUploadPlaceholderAction =
  | { type: 'add', position: number, data: ImageUploadPlaceholderData }
  | {
      type: 'update'
      id: string
      patch: ImageUploadPlaceholderPatch
    }
  | { type: 'remove', id: string }
  | { type: 'insert', id: string, imageDiffId: string }
  | { type: 'clear' }

export const imageUploadPlaceholderPluginKey = new PluginKey<DecorationSet>('imageUploadPlaceholder')

function dispatchPlaceholderAction(
  element: HTMLElement,
  eventName: string,
  detail: Record<string, unknown>,
) {
  element.dispatchEvent(
    new CustomEvent(eventName, {
      bubbles: true,
      detail,
    }),
  )
}

function createActionButton(label: string, className: string, onClick: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return button
}

function createPlaceholderElement(spec: ImageUploadPlaceholderSpec) {
  const root = document.createElement('span')
  root.className = 'requirement-image-upload'
  root.dataset.imageUploadId = spec.id
  root.dataset.status = spec.status
  root.contentEditable = 'false'
  root.setAttribute('role', spec.status === 'error' ? 'alert' : 'status')
  root.setAttribute('aria-live', 'polite')

  if (spec.width && spec.height) {
    root.dataset.imageUploadSized = 'true'
    root.style.width = '100%'
    root.style.maxWidth = `${spec.width}px`
  }

  const frame = document.createElement('span')
  frame.className = 'requirement-image-upload__frame'
  if (spec.width && spec.height) {
    frame.style.aspectRatio = `${spec.width} / ${spec.height}`
  }

  if (spec.previewUrl) {
    const image = document.createElement('img')
    image.className = 'requirement-image-upload__preview'
    image.src = spec.previewUrl
    image.alt = ''
    image.draggable = false
    image.addEventListener('load', () => {
      if (!image.naturalWidth || !image.naturalHeight) return
      dispatchPlaceholderAction(root, 'requirement-image-upload-preview-ready', {
        id: spec.id,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })
    })
    frame.append(image)
  } else {
    const fallback = document.createElement('span')
    fallback.className = 'requirement-image-upload__preview-fallback'
    fallback.setAttribute('aria-hidden', 'true')
    frame.append(fallback)
  }

  const overlay = document.createElement('span')
  overlay.className = 'requirement-image-upload__overlay'

  const status = document.createElement('span')
  status.className = 'requirement-image-upload__status'

  if (spec.status === 'uploading') {
    const spinner = document.createElement('span')
    spinner.className = 'requirement-image-upload__spinner'
    spinner.setAttribute('aria-hidden', 'true')
    status.append(spinner)
  }

  const statusText = document.createElement('span')
  statusText.className = 'requirement-image-upload__status-text'

  const title = document.createElement('strong')
  title.textContent = spec.status === 'error' ? '图片上传失败' : '图片上传中…'

  const detail = document.createElement('small')
  detail.textContent = spec.status === 'error'
    ? spec.errorMessage || '请重试或移除此图片'
    : spec.fileName

  statusText.append(title, detail)
  status.append(statusText)
  overlay.append(status)

  const actions = document.createElement('span')
  actions.className = 'requirement-image-upload__actions'

  if (spec.status === 'error') {
    actions.append(
      createActionButton('重试', 'requirement-image-upload__action requirement-image-upload__action--primary', () => {
        dispatchPlaceholderAction(root, 'requirement-image-upload-retry', { id: spec.id })
      }),
    )
  }

  actions.append(
    createActionButton(
      spec.status === 'error' ? '移除' : '取消',
      'requirement-image-upload__action',
      () => {
        dispatchPlaceholderAction(root, 'requirement-image-upload-dismiss', { id: spec.id })
      },
    ),
  )
  overlay.append(actions)

  frame.append(overlay)
  root.append(frame)
  // 块级预览前保留文字行的零宽位置；随整个上传 widget 存续，避免在 IME 首字时移除 DOM。
  const anchor = document.createElement('span')
  anchor.className = 'requirement-image-upload__caret-anchor'
  anchor.dataset.imageUploadCaretAnchor = spec.id
  anchor.setAttribute('aria-hidden', 'true')
  anchor.textContent = '\u200b'
  const wrapper = document.createElement('span')
  wrapper.append(anchor, root)
  return wrapper
}

function createPlaceholderDecoration(position: number, spec: ImageUploadPlaceholderSpec) {
  // 事务映射可能重建 ViewDesc；同一个占位版本仍复用它的定位 DOM。
  let element: HTMLElement | undefined
  return Decoration.widget(position, () => element ??= createPlaceholderElement(spec), {
    ...spec,
    key: `${spec.id}:${spec.renderVersion}`,
    side: spec.order,
    ignoreSelection: true,
    stopEvent: () => true,
  })
}

function isImageUploadPlaceholder(spec: unknown): spec is ImageUploadPlaceholderSpec {
  return Boolean(
    spec
      && typeof spec === 'object'
      && (spec as ImageUploadPlaceholderSpec).kind === 'image-upload-placeholder',
  )
}

function findPlaceholder(decorations: DecorationSet, id: string) {
  return decorations.find(undefined, undefined, spec => isImageUploadPlaceholder(spec) && spec.id === id)
}

export function findImageUploadPlaceholderPosition(view: EditorView, id: string) {
  const decorations = imageUploadPlaceholderPluginKey.getState(view.state)
  return decorations ? findPlaceholder(decorations, id)[0]?.from : undefined
}

export function findImageUploadCaretAnchor(view: EditorView, position: number) {
  const upload = imageUploadPlaceholderPluginKey.getState(view.state)?.find(position, position)
    .sort((first, second) => first.spec.order - second.spec.order)[0]
  if (!upload) return null
  return view.dom.querySelector<HTMLElement>(`[data-image-upload-caret-anchor="${CSS.escape(upload.spec.id)}"]`)
}

export function addImageUploadPlaceholder(
  view: EditorView,
  data: ImageUploadPlaceholderData,
  position = view.state.selection.from,
) {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.content.size))
  view.dispatch(
    view.state.tr.setMeta(imageUploadPlaceholderPluginKey, {
      type: 'add',
      position: safePosition,
      data,
    } satisfies ImageUploadPlaceholderAction),
  )
}

export function updateImageUploadPlaceholder(
  view: EditorView,
  id: string,
  patch: ImageUploadPlaceholderPatch,
) {
  if (findImageUploadPlaceholderPosition(view, id) === undefined) return false

  view.dispatch(
    view.state.tr.setMeta(imageUploadPlaceholderPluginKey, {
      type: 'update',
      id,
      patch,
    } satisfies ImageUploadPlaceholderAction),
  )
  return true
}

export function removeImageUploadPlaceholder(view: EditorView, id: string) {
  if (findImageUploadPlaceholderPosition(view, id) === undefined) return false

  view.dispatch(
    view.state.tr.setMeta(imageUploadPlaceholderPluginKey, {
      type: 'remove',
      id,
    } satisfies ImageUploadPlaceholderAction),
  )
  return true
}

export function clearImageUploadPlaceholders(view: EditorView) {
  view.dispatch(
    view.state.tr.setMeta(imageUploadPlaceholderPluginKey, {
      type: 'clear',
    } satisfies ImageUploadPlaceholderAction),
  )
}

export const ImageUploadPlaceholder = Extension.create({
  name: 'imageUploadPlaceholder',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: imageUploadPlaceholderPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previousDecorations, oldState) {
            const action = transaction.getMeta(imageUploadPlaceholderPluginKey) as
              | ImageUploadPlaceholderAction
              | undefined
            const removed = new Set<string>()
            let decorations = previousDecorations.map(transaction.mapping, transaction.doc, {
              onRemove: spec => { if (isImageUploadPlaceholder(spec)) removed.add(spec.id) },
            })
            const sync = ySyncPluginKey.getState(oldState)
            if (sync?.binding && isChangeOrigin(transaction)) {
              // Yjs 的远端事务可能替换整棵 ProseMirror 树，普通 Decoration 映射会误删上传占位。
              decorations = DecorationSet.create(transaction.doc, previousDecorations.find().map(decoration => {
                let position: number | null = null
                try {
                  if (decoration.spec.relativePosition) position = relativePositionToAbsolutePosition(sync.doc, sync.type,
                    Y.createRelativePositionFromJSON(JSON.parse(decoration.spec.relativePosition)), sync.binding.mapping)
                } catch { /* 保留无法解码的旧占位，回退到事务映射位置。 */ }
                return createPlaceholderDecoration(Math.max(0, Math.min(position ?? transaction.mapping.map(decoration.from), transaction.doc.content.size)), decoration.spec as ImageUploadPlaceholderSpec)
              }))
            } else {
              const inserted = action?.type === 'insert' ? findPlaceholder(previousDecorations, action.id)[0] : undefined
              let imageRange: { from: number, to: number } | undefined
              if (inserted && action?.type === 'insert') {
                transaction.doc.descendants((node, position) => {
                  if (node.type.name === 'image' && node.attrs.diffId === action.imageDiffId) {
                    imageRange = { from: position, to: position + node.nodeSize }
                  }
                })
              }
              for (const previous of previousDecorations.find()) {
                // 块图片会替换空段或拆开文本块；被删除的 widget 仍代表未完成的任务。
                // 失败后重试的较早任务留在新图片之前，其余同位置任务跟到图片之后。
                let position: number
                if (inserted && imageRange && previous.from === inserted.from) {
                  position = previous.spec.order < inserted.spec.order ? imageRange.from : imageRange.to
                } else {
                  if (!removed.has(previous.spec.id)) continue
                  position = transaction.mapping.map(previous.from)
                }
                decorations = decorations.remove(findPlaceholder(decorations, previous.spec.id)).add(transaction.doc, [
                  createPlaceholderDecoration(Math.max(0, Math.min(position, transaction.doc.content.size)), previous.spec as ImageUploadPlaceholderSpec),
                ])
              }
            }

            if (!action || action.type === 'insert') return decorations
            if (action.type === 'clear') return DecorationSet.empty

            if (action.type === 'remove') {
              decorations = decorations.remove(findPlaceholder(decorations, action.id))
              // 插入事务已同步到 Yjs；为剩余任务记录新位置，防止远端更新将其移回旧段落。
              if (sync?.binding) {
                decorations = DecorationSet.create(transaction.doc, decorations.find().map(decoration => {
                  const relative = absolutePositionToRelativePosition(decoration.from, sync.type, sync.binding.mapping)
                  return createPlaceholderDecoration(decoration.from, {
                    ...decoration.spec as ImageUploadPlaceholderSpec,
                    relativePosition: relative ? JSON.stringify(Y.relativePositionToJSON(relative)) : undefined,
                  })
                }))
              }
              return decorations
            }

            if (action.type === 'update') {
              const matches = findPlaceholder(decorations, action.id)
              const current = matches[0]
              if (!current || !isImageUploadPlaceholder(current.spec)) return decorations

              const nextSpec: ImageUploadPlaceholderSpec = {
                ...current.spec,
                ...action.patch,
                renderVersion: current.spec.renderVersion + 1,
              }
              return decorations
                .remove(matches)
                .add(transaction.doc, [createPlaceholderDecoration(current.from, nextSpec)])
            }

            const existing = findPlaceholder(decorations, action.data.id)
            if (existing.length) decorations = decorations.remove(existing)

            const spec: ImageUploadPlaceholderSpec = {
              ...action.data,
              kind: 'image-upload-placeholder',
              renderVersion: 0,
            }
            if (!spec.relativePosition && sync?.binding) {
              const relative = absolutePositionToRelativePosition(action.position, sync.type, sync.binding.mapping)
              if (relative) spec.relativePosition = JSON.stringify(Y.relativePositionToJSON(relative))
            }
            return decorations.add(transaction.doc, [createPlaceholderDecoration(action.position, spec)])
          },
        },
        props: {
          decorations(state) {
            return imageUploadPlaceholderPluginKey.getState(state)
          },
        },
      }),
    ]
  },
})
