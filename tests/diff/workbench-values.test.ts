import { describe, expect, it } from 'vitest'
import { formatWorkValue, workValueNumber, type WorkValue } from '../../shared/statistics/workbench'

describe('个人统计的精确值与已确认下界', () => {
  it.each<[(WorkValue | undefined), number | null, string]>([
    [undefined, null, '—'],
    [{ value: 0, knownValue: 0, quality: 'complete', completeFrom: null, reason: null }, 0, '0'],
    [{ value: 7, knownValue: 7, quality: 'complete', completeFrom: null, reason: null }, 7, '7'],
    [{ value: null, knownValue: 6, quality: 'incomplete', completeFrom: null, reason: 'missing_history' }, 6, '≥6'],
    [{ value: null, knownValue: 0, quality: 'incomplete', completeFrom: null, reason: 'missing_history' }, null, '—'],
    [{ value: null, knownValue: null, quality: 'future', completeFrom: null, reason: 'future' }, null, '—'],
  ])('数值 %j 用于绘图和显示时保留质量区别', (item, number, label) => {
    expect(workValueNumber(item)).toBe(number)
    expect(formatWorkValue(item)).toBe(label)
  })
})
