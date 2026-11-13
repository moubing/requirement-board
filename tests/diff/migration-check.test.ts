import { expect, it } from 'vitest'
import { checkMigrationHistory, readMigrationHistory } from '../../scripts/check-migrations.mjs'

const first = { idx: 0, tag: '0000_first', when: 100, hash: 'one' }
const second = { idx: 1, tag: '0001_second', when: 200, hash: 'two' }
it('接受顺序追加，拦截编号、时间冲突和遗漏的历史迁移', () => {
  expect(checkMigrationHistory([first, second], [first])).toEqual([])
  expect(checkMigrationHistory([first, { ...second, tag: '20261019130000_second' }], [first])).toEqual([])
  expect(checkMigrationHistory([{ ...first, tag: '20261019130000_first' }, { ...second, tag: '20261019130000_second' }])).not.toEqual([])
  expect(checkMigrationHistory([first, { ...second, when: 100 }])).not.toEqual([])
  expect(checkMigrationHistory([first, { ...second, idx: 0 }])).not.toEqual([])
  expect(checkMigrationHistory([first], [first, second])).toContain('0001_second：已合入的迁移被移除')
})
it('即使重命名也识别历史 SQL，阻止改时间、改 SQL 和往历史中插入迁移', () => {
  expect(checkMigrationHistory([first, { ...second, tag: '0001_renamed', when: 300 }], [first, second]).join('\n')).toContain('已合入的执行时间被修改')
  expect(checkMigrationHistory([first, { ...second, hash: 'changed' }], [first, second]).join('\n')).toContain('已合入的 SQL 被修改')
  expect(checkMigrationHistory([first, { idx: 1, tag: '0001_inserted', when: 150, hash: 'inserted' }, { ...second, idx: 2, tag: '0002_second' }], [first, second]).join('\n')).toContain('已有数据库可能跳过它')
})
it('不同系统换行不误报历史 SQL 变化', async () => {
  const journal = JSON.stringify({ entries: [first] })
  const read = (sql: string) => (path: string) => Promise.resolve(path.endsWith('.json') ? journal : sql)
  const base = await readMigrationHistory(read('select 1;\r\n'))
  const current = await readMigrationHistory(read('select 1;\n'))
  expect(checkMigrationHistory(current, base)).toEqual([])
})
