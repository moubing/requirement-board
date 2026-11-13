import { afterEach, describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import {
  calculateSmoothCaretGeometry,
  createEmptyCaretAnchorDecorations,
  emptyCaretAnchorCoordinates,
  isEmptyTextblockSelection,
} from '../../app/components/editor/smooth-caret-extension'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*' },
    text: { group: 'inline' },
  },
})

function createListItemSelection(text = '') {
  const paragraph = schema.node(
    'paragraph',
    null,
    text ? schema.text(text) : undefined,
  )
  const doc = schema.node('doc', null, [
    schema.node('orderedList', null, [
      schema.node('listItem', null, [paragraph]),
    ]),
  ])
  let paragraphPosition = -1
  doc.descendants((node, position) => {
    if (node.type.name !== 'paragraph') return
    paragraphPosition = position
    return false
  })
  return TextSelection.create(doc, paragraphPosition + 1 + text.length)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('smooth editor caret geometry', () => {
  it('positions the caret relative to its editor host and scroll offset', () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 })

    expect(
      calculateSmoothCaretGeometry(
        { left: 248.25, top: 180.5, bottom: 204.5 },
        { left: 100, top: 80 },
        12,
        6,
      ),
    ).toEqual({
      x: 160.5,
      y: 107.5,
      height: 22,
    })
  })

  it('keeps a short line cursor visible without producing a negative height', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 })

    expect(
      calculateSmoothCaretGeometry(
        { left: 18, top: 12, bottom: 12 },
        { left: 8, top: 2 },
      ),
    ).toEqual({
      x: 10,
      y: 10,
      height: 2,
    })
  })

  it('adds a view-only anchor decoration for an empty nested list item', () => {
    const selection = createListItemSelection()
    const state = EditorState.create({ doc: selection.$head.doc, selection })
    const documentBeforeDecoration = state.doc.toJSON()
    const decorations = createEmptyCaretAnchorDecorations(state).find()

    expect(isEmptyTextblockSelection(selection)).toBe(true)
    expect(decorations).toHaveLength(1)
    expect(decorations[0]?.from).toBe(selection.head)
    expect(decorations[0]?.spec.key).toBe('requirement-empty-caret-anchor')
    expect(state.doc.toJSON()).toEqual(documentBeforeDecoration)

    const textSelection = createListItemSelection('x')
    const textState = EditorState.create({ doc: textSelection.$head.doc, selection: textSelection })
    expect(isEmptyTextblockSelection(textSelection)).toBe(false)
    expect(createEmptyCaretAnchorDecorations(textState).find()).toHaveLength(0)
  })

  it('reads the empty caret coordinates from its decoration anchor', () => {
    const anchor = {
      getBoundingClientRect: () => ({ left: 42, top: 120, bottom: 141 }),
    }
    const root = {
      querySelector: () => anchor,
    } as unknown as ParentNode

    expect(emptyCaretAnchorCoordinates(root)).toEqual({
      left: 42,
      top: 120,
      bottom: 141,
    })
  })
})
