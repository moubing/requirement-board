import type { Editor } from '@tiptap/core'
import { GapCursor } from '@tiptap/pm/gapcursor'
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model'
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state'

type CaptionEdge = 'start' | 'end'
type VerticalDirection = 'up' | 'down'

interface ImageCaptionContext {
  imageCaptionType: NodeType
  imageType: NodeType
  imagePosition: number
  positionAfterImage: number
}

function resolveImageCaptionContext(state: EditorState): ImageCaptionContext | null {
  const { $from, $to } = state.selection
  const imageCaptionType = state.schema.nodes.imageCaption
  const imageType = state.schema.nodes.image

  if (
    !imageCaptionType
    || !imageType
    || $from.parent.type !== imageCaptionType
    || $to.parent.type !== imageCaptionType
  ) {
    return null
  }

  let imageDepth = $from.depth - 1
  while (imageDepth > 0 && $from.node(imageDepth).type !== imageType) {
    imageDepth -= 1
  }
  if (imageDepth === 0 || $from.node(imageDepth).type !== imageType) return null

  const imagePosition = $from.before(imageDepth)
  return {
    imageCaptionType,
    imageType,
    imagePosition,
    positionAfterImage: imagePosition + $from.node(imageDepth).nodeSize,
  }
}

function imageCaptionSelection(
  document: ProseMirrorNode,
  imagePosition: number,
  image: ProseMirrorNode,
  imageCaptionType: NodeType,
  edge: CaptionEdge,
) {
  let captionPosition: number | null = null
  image.descendants((node, relativePosition) => {
    if (node.type !== imageCaptionType) return
    const captionStart = imagePosition + 1 + relativePosition + 1
    captionPosition = edge === 'start'
      ? captionStart
      : captionStart + node.content.size
    return false
  })

  return captionPosition === null
    ? null
    : TextSelection.create(document, captionPosition)
}

function followingImageCaptionSelection(
  document: ProseMirrorNode,
  positionAfterImage: number,
  imageType: NodeType,
  imageCaptionType: NodeType,
) {
  const nextImage = document.nodeAt(positionAfterImage)
  if (!nextImage || nextImage.type !== imageType) return null
  return imageCaptionSelection(document, positionAfterImage, nextImage, imageCaptionType, 'start')
}

function precedingImageCaptionSelection(
  document: ProseMirrorNode,
  imagePosition: number,
  imageType: NodeType,
  imageCaptionType: NodeType,
) {
  const previousImage = document.resolve(imagePosition).nodeBefore
  if (!previousImage || previousImage.type !== imageType) return null

  return imageCaptionSelection(
    document,
    imagePosition - previousImage.nodeSize,
    previousImage,
    imageCaptionType,
    'end',
  )
}

function adjacentImageCaptionSelection(
  state: EditorState,
  context: ImageCaptionContext,
  direction: VerticalDirection,
) {
  return direction === 'down'
    ? followingImageCaptionSelection(
        state.doc,
        context.positionAfterImage,
        context.imageType,
        context.imageCaptionType,
      )
    : precedingImageCaptionSelection(
        state.doc,
        context.imagePosition,
        context.imageType,
        context.imageCaptionType,
      )
}

function redirectAdjacentImageGapCursor(previousState: EditorState, state: EditorState) {
  const { selection } = state
  const imageType = state.schema.nodes.image
  const imageCaptionType = state.schema.nodes.imageCaption
  if (
    !(selection instanceof GapCursor)
    || !imageType
    || !imageCaptionType
    || selection.$from.nodeBefore?.type !== imageType
    || selection.$from.nodeAfter?.type !== imageType
  ) {
    return null
  }

  const previousContext = resolveImageCaptionContext(previousState)
  const direction: VerticalDirection = previousContext?.imagePosition === selection.$from.pos
    ? 'up'
    : 'down'
  const captionSelection = direction === 'up'
    ? precedingImageCaptionSelection(
        state.doc,
        selection.$from.pos,
        imageType,
        imageCaptionType,
      )
    : followingImageCaptionSelection(
        state.doc,
        selection.$from.pos,
        imageType,
        imageCaptionType,
      )
  if (!captionSelection) return null

  return state.tr
    .setSelection(captionSelection)
    .setMeta('addToHistory', false)
    .scrollIntoView()
}

export function createImageCaptionNavigationPlugin() {
  return new Plugin({
    appendTransaction(transactions, previousState, nextState) {
      if (!transactions.some(transaction => transaction.selectionSet)) return null
      return redirectAdjacentImageGapCursor(previousState, nextState)
    },
  })
}

function moveToAdjacentImageCaption(editor: Editor, direction: VerticalDirection) {
  const { state, view } = editor
  const context = resolveImageCaptionContext(state)
  if (!context) return false

  const captionIsEmpty = state.selection.$from.parent.content.size === 0
  if (!captionIsEmpty && !view.endOfTextblock(direction)) return false

  const captionSelection = adjacentImageCaptionSelection(state, context, direction)
  if (!captionSelection) return false

  view.dispatch(state.tr.setSelection(captionSelection).scrollIntoView())
  return true
}

export function moveToNextImageCaption(editor: Editor) {
  return moveToAdjacentImageCaption(editor, 'down')
}

export function moveToPreviousImageCaption(editor: Editor) {
  return moveToAdjacentImageCaption(editor, 'up')
}

export function leaveImageCaption(editor: Editor) {
  const { state, view } = editor
  const context = resolveImageCaptionContext(state)
  if (!context) return false

  const paragraphType = state.schema.nodes.paragraph
  if (!paragraphType) return false

  const nodeAfterImage = state.doc.nodeAt(context.positionAfterImage)
  const transaction = nodeAfterImage?.type === paragraphType
    ? state.tr
    : state.tr.insert(context.positionAfterImage, paragraphType.create())
  const paragraphSelection = TextSelection.create(
    transaction.doc,
    context.positionAfterImage + 1,
  )
  view.dispatch(transaction.setSelection(paragraphSelection).scrollIntoView())
  return true
}
