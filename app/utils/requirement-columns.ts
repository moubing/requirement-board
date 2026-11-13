import type { BingTableColumn, BingTableFixed } from '@moubing/bing-ui'

export interface RequirementColumnPreferences {
  widths: Record<string, number>
  order: string[]
  hidden: string[]
  fixed: Record<string, BingTableFixed | null>
}
export const emptyRequirementColumns = (): RequirementColumnPreferences => ({ widths: {}, order: [], hidden: [], fixed: {} })
export function requirementColumns(home = false): BingTableColumn[] {
  const columns: BingTableColumn[] = [
    { key: 'key', title: '编号', width: 105, sortable: true },
    { key: 'title', title: '文档标题', minWidth: home ? 240 : 320, sortable: true, ellipsis: false },
    { key: 'documentType', title: '类型', width: 90, sortable: true },
    { key: 'status', title: '状态', width: 135, sortable: true },
    { key: 'priority', title: '优先级', width: 120, sortable: true },
    { key: 'assignees', title: '负责人', width: 160, sortable: true, ellipsis: false },
    { key: 'updatedAt', title: '更新时间', width: 175, sortable: true },
  ]
  return home ? columns.filter(column => column.key !== 'assignees') : columns
}
