import { describe, expect, it } from 'vitest'

import { resolveComparisonSelection, resolveRevisionId } from '../../app/components/revision/revision-selection'

describe('resolveRevisionId', () => {
  const revisions = [{ id: 'rev-3' }, { id: 'rev-2' }, { id: 'rev-1' }]

  it('保留仍然存在的历史版本选择', () => {
    expect(resolveRevisionId(revisions, 'rev-1')).toBe('rev-1')
  })

  it('没有选择或原选择失效时回到最新版本', () => {
    expect(resolveRevisionId(revisions, '')).toBe('rev-3')
    expect(resolveRevisionId(revisions, 'missing')).toBe('rev-3')
  })

  it('没有历史版本时返回空值', () => {
    expect(resolveRevisionId([], 'rev-1')).toBe('')
  })
})

describe('相邻版本比较', () => {
  const revisions = [{ id: 'v3', version: 3 }, { id: 'v1', version: 1 }, { id: 'v2', version: 2 }]
  const resolve = (baseId: string, targetId: string, changed: 'base' | 'target', adjacent = true) =>
    resolveComparisonSelection(revisions, { baseId, targetId }, changed, adjacent, 'draft')

  it('默认比较最新正式版本和共同文档', () => {
    expect(resolve('', '', 'target')).toEqual({ baseId: 'v3', targetId: 'draft' })
  })
  it('改变旧版本时选择下一版，最新正式版本对应共同文档', () => {
    expect(resolve('v2', 'draft', 'base')).toEqual({ baseId: 'v2', targetId: 'v3' })
    expect(resolve('v3', 'v2', 'base')).toEqual({ baseId: 'v3', targetId: 'draft' })
  })
  it('改变新版本时选择上一版；最旧版的旧链接回到首个可比较版本对', () => {
    expect(resolve('v3', 'v2', 'target')).toEqual({ baseId: 'v1', targetId: 'v2' })
    expect(resolve('v3', 'v1', 'target')).toEqual({ baseId: 'v1', targetId: 'v2' })
  })
  it('解除联动后保留自由选择，重新开启时按旧版本配对', () => {
    expect(resolve('v1', 'v3', 'base', false)).toEqual({ baseId: 'v1', targetId: 'v3' })
    expect(resolve('v1', 'v3', 'base')).toEqual({ baseId: 'v1', targetId: 'v2' })
  })
  it('处理空记录、单版本以及已失效选择', () => {
    const selection = { baseId: 'missing', targetId: 'missing' }
    expect(resolveComparisonSelection([], selection, 'target', true, 'draft')).toEqual({ baseId: '', targetId: 'draft' })
    expect(resolveComparisonSelection([revisions[1]!], selection, 'target', true, 'draft')).toEqual({ baseId: 'v1', targetId: 'draft' })
    expect(resolve('missing', 'missing', 'base')).toEqual({ baseId: 'v3', targetId: 'draft' })
  })
  it('版本刷新后共同文档跟随最新版本，已有正式版本对保持不变', () => {
    const refreshed = [{ id: 'v4', version: 4 }, ...revisions]
    expect(resolveComparisonSelection(refreshed, { baseId: 'v3', targetId: 'draft' }, 'target', true, 'draft')).toEqual({ baseId: 'v4', targetId: 'draft' })
    expect(resolveComparisonSelection(refreshed, { baseId: 'v1', targetId: 'v2' }, 'target', true, 'draft')).toEqual({ baseId: 'v1', targetId: 'v2' })
    expect(revisions.map(revision => revision.id)).toEqual(['v3', 'v1', 'v2'])
  })
})
