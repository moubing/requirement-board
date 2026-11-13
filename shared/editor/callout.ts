import type { RichTextNode } from './document'

export const calloutTones = ['note', 'tip', 'warning', 'danger'] as const
export type CalloutTone = typeof calloutTones[number]
export const calloutToneDetails = {
  note: { label: '说明', description: '补充背景、统计口径、名词解释', placeholder: '输入说明…' },
  tip: { label: '建议', description: '推荐做法、备选方案、经验', placeholder: '输入建议…' },
  warning: { label: '注意', description: '依赖、前置条件、易错处', placeholder: '输入注意事项…' },
  danger: { label: '风险', description: '禁止项、上线风险、不可逆操作', placeholder: '输入风险…' },
} as const

export function isCalloutTone(value: unknown): value is CalloutTone {
  return typeof value === 'string' && calloutTones.includes(value as CalloutTone)
}

/** 只用于展示旧数据；不写回 JSON 或历史。 */
export function displayCalloutTone(value: unknown): CalloutTone {
  return isCalloutTone(value) ? value : 'note'
}

export function calloutToneChange(base?: RichTextNode | null, target?: RichTextNode | null) {
  if (base?.type !== 'callout' || target?.type !== 'callout') return ''
  const before = displayCalloutTone(base.attrs?.tone)
  const after = displayCalloutTone(target.attrs?.tone)
  return before === after ? '' : `语气：${calloutToneDetails[before].label} → ${calloutToneDetails[after].label}`
}
