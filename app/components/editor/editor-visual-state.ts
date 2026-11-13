import type { ComputedRef, InjectionKey } from 'vue'

/** Tiptap VueRenderer 继承 EditorContent 的 provides，NodeView 无需改写正文 DOM。 */
export const editorVisualStateKey: InjectionKey<ComputedRef<boolean>> = Symbol('editor-visual-active')
export const editorEditableStateKey: InjectionKey<ComputedRef<boolean>> = Symbol('editor-editable')
export const editorActiveStateKey: InjectionKey<ComputedRef<boolean>> = Symbol('editor-active')
