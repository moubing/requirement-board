import { describe, expect, it } from 'vitest'
import { buildVersionMarkerStrokes, connectVersionMarkerGeometry, type VersionMarkerGeometry } from '../../app/components/editor/version-marker-layout'
import type { VersionMarker } from '../../shared/diff/version-markers'

function item(id: string, beforeId: string | null, top: number, height = 28, status: VersionMarker['status'] = 'inserted'): VersionMarkerGeometry {
  return { marker: { id: `${status}:${id}`, status, targetId: status === 'deleted' ? null : id, beforeId, afterId: null, pairs: [] }, top, height, left: 20 }
}

describe('版本标记的连续竖线', () => {
  it.each(['inserted', 'modified'] as const)('连接相邻 %s 块并平分间距，保留每个块的身份和外侧边界', status => {
    const input = [item('a', null, 0, 28, status), item('b', 'a', 42, 100, status), item('c', 'b', 170, 28, status)]
    const snapshot = structuredClone(input)
    const result = connectVersionMarkerGeometry(input)
    expect(result.map(({ top, height, joinedBefore, joinedAfter }) => ({ top, height, joinedBefore, joinedAfter }))).toEqual([
      { top: 0, height: 35, joinedBefore: false, joinedAfter: true },
      { top: 35, height: 121, joinedBefore: true, joinedAfter: true },
      { top: 156, height: 42, joinedBefore: true, joinedAfter: false },
    ])
    expect(result.map(segment => segment.marker)).toEqual(input.map(segment => segment.marker))
    expect(input).toEqual(snapshot)
  })

  it('不跨过未修改块、缺失的块或不同状态', () => {
    const result = connectVersionMarkerGeometry([
      item('a', null, 0), item('b', 'unchanged', 84), item('c', 'b', 126, 28, 'modified'), item('d', 'missing', 210, 28, 'modified'),
    ])
    expect(result.every(segment => !segment.joinedBefore && !segment.joinedAfter)).toBe(true)
  })

  it('删除标记截断同类竖线，保持短横线的坐标和尺寸', () => {
    const input = [item('a', null, 0, 28, 'modified'), item('removed', 'a', 31, 8, 'deleted'), item('b', 'a', 42, 28, 'modified')]
    expect(connectVersionMarkerGeometry(input)).toEqual(input.map(segment => ({ ...segment, joinedBefore: false, joinedAfter: false })))
  })

  it('先在全文连接，再裁剪可见标记时仍覆盖视口边界', () => {
    const result = connectVersionMarkerGeometry(Array.from({ length: 50 }, (_, index) => item(`${index}`, index ? `${index - 1}` : null, index * 42)))
    const visible = result.filter(segment => segment.top + segment.height >= 400 && segment.top <= 900)
    expect(visible[0]!.top).toBeLessThanOrEqual(400)
    expect(visible.at(-1)!.top + visible.at(-1)!.height).toBeGreaterThanOrEqual(900)
    for (let index = 1; index < visible.length; index++) expect(visible[index]!.top).toBe(visible[index - 1]!.top + visible[index - 1]!.height)
  })

  it('连续区间共用一条完整笔画，未修改块、状态变化和删除仍分隔绘制', () => {
    const input = [item('a', null, 0), item('b', 'a', 42), item('c', 'b', 84), item('d', 'unchanged', 168),
      item('e', 'd', 210, 28, 'modified'), item('removed', 'e', 241, 8, 'deleted'), item('f', 'e', 252, 28, 'modified')]
    const segments = connectVersionMarkerGeometry(input)
    const snapshot = structuredClone(segments)
    expect(buildVersionMarkerStrokes(segments)).toEqual([{ ...input[0], height: 112 }, ...input.slice(3)])
    expect(segments).toEqual(snapshot)
    expect(buildVersionMarkerStrokes([])).toEqual([])
  })

  it('重叠、零高或不同横向位置时不制造交叠热区，恢复排布后重新连接', () => {
    for (const next of [item('b', 'a', 20), item('b', 'a', 42, 0), { ...item('b', 'a', 42), left: 40 }]) {
      expect(connectVersionMarkerGeometry([item('a', null, 0), next]).every(segment => !segment.joinedBefore && !segment.joinedAfter)).toBe(true)
    }
    expect(connectVersionMarkerGeometry([item('a', null, 0), item('b', 'a', 28)])[1]!.joinedBefore).toBe(true)
    expect(connectVersionMarkerGeometry([])).toEqual([])
  })
})
