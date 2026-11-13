import type { Editor } from '@tiptap/core'
import { normalizeCodeLanguage } from '@moubing/bing-ui'
import { codeLanguageOptions } from './code-highlight'
import { dispatchIsolatedHistory } from './isolated-history'
import { normalizeCodeBlockTitle } from '~~/shared/editor/code-block'

export function setCodeBlockLanguage(editor: Editor, id: string, language: unknown) {
  if (!editor.isEditable || typeof language !== 'string') return false
  const normalized = normalizeCodeLanguage(language)
  if (!codeLanguageOptions.some(option => option.value === normalized)) return false
  return setCodeBlockAttribute(editor, id, 'language', normalized === 'text' ? null : normalized)
}

export function setCodeBlockTitle(editor: Editor, id: string, title: string) {
  return setCodeBlockAttribute(editor, id, 'title', normalizeCodeBlockTitle(title))
}

function setCodeBlockAttribute(editor: Editor, id: string, attribute: 'language' | 'title', value: string | null) {
  if (editor.isDestroyed || !editor.isEditable) return false
  let position: number | undefined
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock' && node.attrs.diffId === id) position = pos })
  if (position === undefined) return false
  const node = editor.state.doc.nodeAt(position)!
  if ((node.attrs[attribute] ?? null) === value) return true
  dispatchIsolatedHistory(editor.view, editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, [attribute]: value }))
  return true
}
