import type { VersionMarker } from '~~/shared/diff/version-markers'

export interface VersionMarkerGeometry {
  marker: VersionMarker
  top: number
  height: number
  left: number
}

export interface VersionMarkerSegment extends VersionMarkerGeometry {
  joinedBefore: boolean
  joinedAfter: boolean
}

/** 相邻同类标记接成连续竖线，间距由两侧平分，查看和恢复仍保留块粒度。 */
export function connectVersionMarkerGeometry(items: readonly VersionMarkerGeometry[]): VersionMarkerSegment[] {
  const segments = items.map(item => ({ ...item, joinedBefore: false, joinedAfter: false }))
  for (let index = 1; index < segments.length; index++) {
    const previous = segments[index - 1]!, current = segments[index]!
    // beforeId 包含未修改块；不能只凭标记数组相邻，就跨过未修改内容连接。
    if (current.marker.status === 'deleted' || current.marker.status !== previous.marker.status
      || !previous.marker.targetId || current.marker.beforeId !== previous.marker.targetId
      || previous.left !== current.left || previous.height <= 0 || current.height <= 0) continue
    const previousBottom = previous.top + previous.height
    // 布局动画可能暂时令块重叠或逆序，等待下一帧正常排布后再连接。
    if (current.top < previousBottom) continue
    const boundary = (previousBottom + current.top) / 2
    const bottom = current.top + current.height
    previous.height = boundary - previous.top
    previous.joinedAfter = true
    current.top = boundary
    current.height = bottom - boundary
    current.joinedBefore = true
  }
  return segments
}

/** 每个连续区间只绘制一条笔画，避免独立线段在小数像素、缩放或透明度合成时产生接缝。 */
export function buildVersionMarkerStrokes(segments: readonly VersionMarkerSegment[]): VersionMarkerGeometry[] {
  const strokes: VersionMarkerGeometry[] = []
  for (const segment of segments) {
    const previous = strokes.at(-1)
    if (segment.joinedBefore && previous) previous.height = segment.top + segment.height - previous.top
    else strokes.push({ marker: segment.marker, top: segment.top, height: segment.height, left: segment.left })
  }
  return strokes
}
