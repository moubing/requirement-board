import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/** 在 NodeView 创建、图片下载及 Diff 输出前阻止未批准的图片进入正文。 */
export const ImageSourcePolicy = Extension.create<{
  sources: readonly string[]
  onBlocked: () => void
}>({
  name: 'imageSourcePolicy',
  addOptions: () => ({ sources: [], onBlocked: () => {} }),
  addProseMirrorPlugins() {
    const { sources, onBlocked } = this.options
    return [new Plugin({
      filterTransaction(transaction) {
        if (!transaction.docChanged) return true
        let allowed = true
        transaction.doc.descendants(node => {
          if (node.type.name === 'image' && !sources.includes(node.attrs.src)) allowed = false
        })
        if (!allowed) onBlocked()
        return allowed
      },
      props: {
        transformPastedHTML(html) {
          // template 内容保持惰性，先移除请求入口，再交给 ProseMirror 的 HTML 解析器。
          const template = document.createElement('template')
          template.innerHTML = html
          let blocked = false
          for (const element of template.content.querySelectorAll('img, source, video, audio, iframe, frame, object, embed, input, link, style, script, base, meta, svg, math, template')) {
            if (element.tagName === 'IMG' && sources.includes(element.getAttribute('src') ?? '')) {
              element.removeAttribute('srcset')
              element.removeAttribute('style')
            } else { element.remove(); blocked = true }
          }
          // 背景 URL 等不属于编辑器正文格式，不能由粘贴触发请求。
          for (const element of template.content.querySelectorAll('*')) {
            for (const attribute of [...element.attributes]) {
              if (attribute.name.startsWith('on') || ['style', 'background', 'srcset'].includes(attribute.name)) element.removeAttribute(attribute.name)
            }
          }
          if (blocked) onBlocked()
          return template.innerHTML
        },
      },
    })]
  },
})
