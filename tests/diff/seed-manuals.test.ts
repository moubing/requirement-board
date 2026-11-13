import { describe, expect, it } from 'vitest'

import { assertLocalResetTarget } from '../../server/db/reset-local'
import { seedManuals, validateSeedManuals } from '../../server/db/seed-data'
import { extractPlainText, type RichTextNode } from '../../shared/editor/document'

describe('使用手册种子', () => {
  it('七篇正文符合 schema，每篇继续阅读完整链接到另外六篇', () => {
    const manuals = validateSeedManuals()
    expect(manuals).toHaveLength(7)
    expect(new Set(manuals.map(manual => manual.id)).size).toBe(7)
    for (const manual of manuals) {
      const heading = manual.contentJson.content.findIndex(node => node.type === 'heading' && extractPlainText(node).includes('继续阅读'))
      expect(heading).toBeGreaterThan(0)
      const list = manual.contentJson.content.slice(heading + 1).find(node => node.type === 'bulletList')!
      const links: string[] = []
      function visit(node: RichTextNode) {
        for (const mark of node.marks ?? []) if (mark.type === 'link') links.push(String(mark.attrs?.href))
        node.content?.forEach(visit)
      }
      visit(list)
      expect(links.sort()).toEqual(seedManuals.filter(other => other.id !== manual.id).map(other => `/requirements/${other.id}`).sort())
      expect(extractPlainText(manual.contentJson).length).toBeGreaterThan(2000)
    }
  })

  it('只允许本机开发库，拒绝远程、隧道、测试库及参数覆盖', () => {
    expect(() => assertLocalResetTarget('postgres://requirement:password@localhost:5438/requirement_board')).not.toThrow()
    for (const url of [
      'postgres://requirement:password@remote.example:5438/requirement_board',
      'postgres://requirement:password@localhost:15439/requirement_board',
      'postgres://requirement:password@localhost:5438/requirement_board_test',
      'postgres://requirement:password@localhost:5438/requirement_board_prod',
      'postgres://other:password@localhost:5438/requirement_board',
      'postgres://requirement:password@localhost:5438/requirement_board?host=remote.example',
    ]) expect(() => assertLocalResetTarget(url)).toThrow()
  })
})
