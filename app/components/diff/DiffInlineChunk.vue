<script lang="ts">
import { defineComponent, h, type CSSProperties, type PropType, type VNodeChild } from 'vue'

import type {
  InlineDiffChunk,
  InlineFormatChange,
  NormalizedInlineMark,
} from '~~/shared/diff/rich-text-diff'

const markLabels: Record<string, string> = {
  bold: '加粗',
  code: '行内代码',
  highlight: '高亮',
  italic: '斜体',
  link: '链接',
  strike: '删除线',
}

function markLabel(mark: NormalizedInlineMark) {
  return markLabels[mark.type] ?? mark.type
}

function markSignature(mark: NormalizedInlineMark) {
  return JSON.stringify(mark.attrs ?? {})
}

function describeFormatChange(change: InlineFormatChange) {
  const before = new Map(change.before.map((mark) => [mark.type, mark]))
  const after = new Map(change.after.map((mark) => [mark.type, mark]))
  const added = change.after.filter((mark) => !before.has(mark.type)).map(markLabel)
  const removed = change.before.filter((mark) => !after.has(mark.type)).map(markLabel)
  const changed = change.after
    .filter((mark) => {
      const previous = before.get(mark.type)
      return previous && markSignature(previous) !== markSignature(mark)
    })
    .map((mark) => {
      if (mark.type === 'link') return '链接地址'
      if (mark.type === 'highlight') return '高亮颜色'
      return `${markLabel(mark)}属性`
    })

  const details = [
    added.length ? `新增${added.join('、')}` : '',
    removed.length ? `取消${removed.join('、')}` : '',
    changed.length ? `${changed.join('、')}已修改` : '',
  ].filter(Boolean)

  return `格式变化：${details.join('；') || '文字样式已调整'}`
}

function wrapMark(content: VNodeChild, mark: NormalizedInlineMark): VNodeChild {
  const children = Array.isArray(content) ? content : [content]

  if (mark.type === 'bold') return h('strong', { class: 'diff-inline-mark diff-inline-mark--bold' }, children)
  if (mark.type === 'italic') return h('em', { class: 'diff-inline-mark diff-inline-mark--italic' }, children)
  if (mark.type === 'strike') return h('s', { class: 'diff-inline-mark diff-inline-mark--strike' }, children)
  if (mark.type === 'code') return h('code', { class: 'diff-inline-mark diff-inline-mark--code' }, children)
  if (mark.type === 'link') {
    return h(
      'span',
      {
        class: 'diff-inline-mark diff-inline-mark--link',
        'data-link-href': String(mark.attrs?.href ?? ''),
      },
      children,
    )
  }
  if (mark.type === 'highlight') {
    const color = typeof mark.attrs?.color === 'string' ? mark.attrs.color : undefined
    const style: CSSProperties | undefined = color ? { backgroundColor: color } : undefined
    return h('mark', { class: 'diff-inline-mark diff-inline-mark--highlight', style }, children)
  }

  return h(
    'span',
    {
      class: 'diff-inline-mark',
      'data-inline-mark': mark.type,
    },
    children,
  )
}

function renderChunkValue(value: string): VNodeChild {
  const parts = value.split('\n')
  const children: VNodeChild[] = []

  for (const [index, part] of parts.entries()) {
    if (index > 0) {
      children.push(h('br', { class: 'diff-chunk__hard-break', 'data-diff-hard-break': 'true' }))
    }
    if (part) children.push(part)
  }

  return children
}

export default defineComponent({
  name: 'DiffInlineChunk',
  props: {
    chunk: {
      type: Object as PropType<InlineDiffChunk>,
      required: true,
    },
    side: {
      type: String as PropType<'base' | 'target'>,
      required: true,
    },
  },
  setup(props) {
    return () => {
      let content: VNodeChild = renderChunkValue(props.chunk.value)
      for (const mark of [...(props.chunk.marks ?? [])].reverse()) {
        content = wrapMark(content, mark)
      }

      const formatDescription = props.chunk.formatChange
        ? describeFormatChange(props.chunk.formatChange)
        : undefined
      const link = props.chunk.marks?.find((mark) => mark.type === 'link')
      const linkHref = typeof link?.attrs?.href === 'string' ? link.attrs.href : ''
      const title = formatDescription || (linkHref ? `链接：${linkHref}` : undefined)

      return h(
        'span',
        {
          class: {
            'diff-chunk': true,
            'diff-chunk--inserted': props.chunk.status === 'inserted',
            'diff-chunk--deleted': props.chunk.status === 'deleted',
            'diff-chunk--format-changed': Boolean(props.chunk.formatChange),
            'diff-chunk--format-base': Boolean(props.chunk.formatChange) && props.side === 'base',
            'diff-chunk--format-target': Boolean(props.chunk.formatChange) && props.side === 'target',
          },
          title,
          'data-format-change': formatDescription,
        },
        [content],
      )
    }
  },
})
</script>
