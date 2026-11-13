export type EditorContextTarget =
  | { kind: 'text'; element: Element | null; label: string }
  | { kind: 'table'; element: HTMLTableCellElement; label: string }
  | { kind: 'image'; element: HTMLElement; label: string }
  | { kind: 'link'; element: HTMLAnchorElement; label: string; href: string }

function tableCellLabel(cell: HTMLTableCellElement) {
  const row = cell.closest('tr')
  const table = cell.closest('table')
  const rowIndex = row && table ? Array.from(table.rows).indexOf(row) : -1
  const columnIndex = cell.cellIndex
  if (rowIndex < 0 || columnIndex < 0) return '当前单元格'
  return `第 ${rowIndex + 1} 行 · 第 ${columnIndex + 1} 列`
}

export function resolveEditorContextTarget(target: EventTarget | null): EditorContextTarget {
  if (!(target instanceof Element)) {
    return { kind: 'text', element: null, label: '文本' }
  }

  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (link) {
    const href = link.getAttribute('href') ?? ''
    return {
      kind: 'link',
      element: link,
      href,
      label: link.textContent?.trim() || href || '链接',
    }
  }

  const imageCaption = target.closest('.requirement-image__caption')
  if (!imageCaption) {
    const image = target.closest<HTMLElement>('.requirement-image')
    if (image) {
      return {
        kind: 'image',
        element: image,
        label: image.querySelector('img')?.getAttribute('alt')?.trim() || '文档图片',
      }
    }
  }

  const cell = target.closest<HTMLTableCellElement>('th, td')
  if (cell) {
    return {
      kind: 'table',
      element: cell,
      label: tableCellLabel(cell),
    }
  }

  return { kind: 'text', element: target, label: '文本' }
}
