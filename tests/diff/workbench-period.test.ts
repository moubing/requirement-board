import { describe, expect, it } from 'vitest'
import { shanghaiDate, shanghaiMidnight, workPeriodDates, workQuerySchema } from '../../shared/statistics/workbench'

describe('个人工作统计周期', () => {
  it('上海零点与服务器时区无关；周一开始且可跨月、跨年', () => {
    expect(shanghaiDate('2026-10-18T15:59:59Z')).toBe('2026-10-18')
    expect(shanghaiDate('2026-10-18T16:00:00Z')).toBe('2026-10-19')
    expect(shanghaiMidnight('2026-10-19')).toBe('2026-10-18T16:00:00.000Z')
    expect(workPeriodDates('week', '2024-03-01')).toMatchObject({ startDate: '2024-02-26', endDate: '2024-03-04' })
    expect(workPeriodDates('week', '2025-01-01').days).toEqual(['2024-12-30', '2024-12-31', '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'])
  })
  it('月份有真实天数，保留上海历史夏令时；不接受滚动日期或越权参数', () => {
    expect(workPeriodDates('month', '2024-02-29').days).toHaveLength(29)
    expect(workPeriodDates('month', '2023-02-28').days).toHaveLength(28)
    expect(workPeriodDates('month', '2026-04-30').days).toHaveLength(30)
    expect(workPeriodDates('month', '2026-12-31')).toMatchObject({ endDate: '2027-01-01', days: expect.any(Array) })
    expect(shanghaiMidnight('1990-07-01')).toBe('1990-06-30T15:00:00.000Z')
    for (const query of [{ date: '2026-02-30' }, { date: '2026-2-1' }, { period: 'year' }, { userId: 'other' }, { period: ['week', 'month'] }]) {
      expect(workQuerySchema.safeParse(query).success).toBe(false)
    }
  })
})
