// 节点标注能力的唯一注册入口；浏览器、服务端 schema 和独立 Skill 共用。
// 普通节点只需 { label, object: true }。正文 schema/稳定 diffId 仍由节点本身负责。
export function createAnnotationNodeRegistry(definitions) {
  return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
    if (!/^[a-zA-Z][\w]*$/.test(name) || !definition.label || ![undefined, 'block', 'children'].includes(definition.text)) throw new Error('节点标注能力定义无效。')
    const object = definition.object === true ? {} : definition.object
    if (object && (!Number.isSafeInteger(object.version ?? 1) || (object.version ?? 1) < 1)) throw new Error('节点标注能力版本无效。')
    return [name, Object.freeze({ ...definition, ...(object ? { object: Object.freeze({ version: 1, ...object }) } : {}) })]
  })))
}

export function tableCellRanges(table) {
  const occupied = [], cells = []
  for (const [row, node] of (table.content ?? []).entries()) {
    let column = 0
    for (const cell of node.content ?? []) {
      while (occupied[row]?.[column]) column++
      const rowspan = Number(cell.attrs?.rowspan ?? 1), colspan = Number(cell.attrs?.colspan ?? 1)
      if (!Number.isInteger(rowspan) || !Number.isInteger(colspan) || rowspan < 1 || colspan < 1 || rowspan > 1000 || colspan > 1000) throw new Error('表格合并范围无效。')
      for (let y = row; y < row + rowspan; y++) {
        occupied[y] ??= []
        for (let x = column; x < column + colspan; x++) {
          if (occupied[y][x]) throw new Error('表格合并范围重叠。')
          occupied[y][x] = true
        }
      }
      cells.push({ node: cell, range: { row: row + 1, column: column + 1, rowspan, colspan } })
      column += colspan
    }
  }
  return cells
}

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',')
const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100
const cellObject = {
  context(node, ancestors, cache) {
    const table = ancestors.findLast(parent => parent.type === 'table')
    if (!table?.attrs?.diffId) throw new Error('单元格缺少所属表格身份。')
    if (!cache.has(table)) cache.set(table, new Map(tableCellRanges(table).map(cell => [cell.node, cell.range])))
    const range = cache.get(table).get(node)
    if (!range) throw new Error('单元格不属于当前表格。')
    return { tableId: table.attrs.diffId, range }
  },
  validateContext(value) {
    return exactKeys(value, ['tableId', 'range']) && identity(value.tableId)
      && exactKeys(value.range, ['row', 'column', 'rowspan', 'colspan'])
      && Object.values(value.range).every(number => Number.isSafeInteger(number) && number > 0 && number <= 100000)
  },
  sameIdentity(before, after) {
    return before.tableId === after.tableId && before.range.rowspan === after.range.rowspan && before.range.colspan === after.range.colspan
  },
  identityError: '单元格所属表格或合并范围已变化，请重新标注。',
  location(context) {
    const { row, column, rowspan, colspan } = context.range
    return `第 ${row}${rowspan > 1 ? `–${row + rowspan - 1}` : ''} 行 · 第 ${column}${colspan > 1 ? `–${column + colspan - 1}` : ''} 列`
  },
  menu: (_target, nested) => nested ? '标注所在单元格' : '标注当前单元格',
}

export const annotationNodeCapabilities = createAnnotationNodeRegistry({
  doc: { label: '正文', text: 'children' },
  paragraph: { label: '段落', text: 'block' },
  heading: { label: '标题', text: 'block' },
  codeBlock: { label: '代码块', text: 'block' },
  bulletList: { label: '无序列表', text: 'children' },
  orderedList: { label: '有序列表', text: 'children' },
  listItem: { label: '列表项', text: 'children' },
  taskList: { label: '任务清单', text: 'children' },
  taskItem: { label: '任务条目', text: 'children', defaultAttrs: { checked: false } },
  blockquote: { label: '引用块', text: 'children' },
  details: { label: '折叠块', text: 'children', object: true },
  detailsSummary: { label: '折叠块标题', text: 'block' },
  detailsContent: { label: '折叠内容', text: 'children' },
  callout: { label: '提示块', text: 'block', object: true },
  image: { label: '图片', summaryAttrs: ['alt', 'title'], ignoredAttrs: ['width', 'height', 'align'], object: {
    context: node => ({ src: node.attrs?.src }),
    validateContext: value => exactKeys(value, ['src']) && typeof value.src === 'string' && value.src.trim().length > 0 && value.src.length <= 4096,
    sameIdentity: (before, after) => before.src === after.src,
    thumbnail: context => context.src,
    dom: { boundsSelector: '.requirement-image__frame', excludeSelector: '.requirement-image__caption', touchSurfaceSelector: '.requirement-image__preview-trigger' },
  } },
  table: { label: '整张表格', object: { dom: { boundsSelector: 'table' } } },
  tableCell: { label: '单元格', ignoredAttrs: ['colwidth'], defaultAttrs: { rowspan: 1, colspan: 1 }, object: cellObject },
  tableHeader: { label: '表头单元格', ignoredAttrs: ['colwidth'], defaultAttrs: { rowspan: 1, colspan: 1 }, object: cellObject },
})

export function nodeAnnotationCapability(nodeType, registry = annotationNodeCapabilities) {
  return Object.hasOwn(registry, nodeType) ? registry[nodeType] : undefined
}

export function annotationNodeManifest(registry = annotationNodeCapabilities) {
  return Object.fromEntries(Object.entries(registry).filter(([, capability]) => capability.object).map(([type, capability]) => [type, {
    version: capability.object.version, label: capability.label,
  }]))
}
