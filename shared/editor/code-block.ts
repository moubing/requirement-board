import CodeBlock from '@tiptap/extension-code-block'

export const CODE_BLOCK_TITLE_MAX_LENGTH = 120

export function normalizeCodeBlockTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CODE_BLOCK_TITLE_MAX_LENGTH) || null
}

/** 编辑器、服务端和协作读取共用属性，旧代码块默认没有名称。 */
export const NamedCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: element => normalizeCodeBlockTitle(element.getAttribute('data-code-title')),
        renderHTML: attrs => attrs.title ? { 'data-code-title': attrs.title } : {},
      },
    }
  },
})
