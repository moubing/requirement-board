import { completionWindowStart, FLOW_STATES, shanghaiDate, shiftDay, staleLevel } from '../../shared/workbench/home'

// 首页工作台的接口替身：工作流文档可被拖拽和菜单修改，负载与数量从同一份状态计算。
export const workbenchRequests = []
/** fail: 下次读取失败的接口；patch: 提交结果；delay/readDelay: 请求耗时；members/completions: 密集布局数据。 */
export const workbenchControl = { fail: new Set(new URLSearchParams(globalThis.location?.search ?? '').get('workbenchFail')?.split(',') ?? []), patch: [], delay: 0, readDelay: 0, members: [], completions: [] }
const asOf = '2026-10-18T07:30:00.000Z'
const today = shanghaiDate(asOf)
const me = { id: 'fixture-user', name: '测试成员', avatarColor: '#3366cc' }
const b = { id: 'member-b', name: '成员乙', avatarColor: '#993366' }
const c = { id: 'member-c', name: '成员丙', avatarColor: '#669933' }
const users = [me, b, c]
const statuses = {
  queued: { id: 'open', code: 'queued', name: '待处理', color: '#2f6fed' },
  doing: { id: 'doing', code: 'doing', name: '进行中', color: '#c15d2b' },
  testing: { id: 'testing', code: 'testing', name: '测试中', color: '#0891b2' },
  done: { id: 'done', code: 'done', name: '已完成', color: '#198754' },
  closed: { id: 'closed', code: 'closed', name: '已关闭', color: '#667085' },
}
const day = (offset, time = '02:00') => `${shiftDay(today, offset)}T${time}:00.000Z`
const doc = (n, key, title, documentType, priority, code, assignees, reporter, lastActivityAt) =>
  ({ id: `flow-${n}`, key, title, documentType, priority, code, assignees, reporter, lastActivityAt })
const initial = () => [
  doc(1, 'REQ-21', '首页工作流拖拽', 'requirement', 'high', 'doing', [me], b, day(-8)),
  doc(2, 'BUG-7', '列表筛选在返回后丢失', 'defect', 'high', 'queued', [me], b, day(-1)),
  doc(3, 'REQ-22', '完成节奏日历', 'requirement', 'medium', 'doing', [me, b], me, day(-1)),
  doc(4, 'TODO-3', '整理发布说明', 'todo', 'low', 'queued', [me], c, day(-28)),
  doc(5, 'REQ-18', '项目动态按日期分组', 'requirement', 'medium', 'testing', [b], me, day(-1)),
  doc(6, 'BUG-9', '暗色主题下的文字对比度不足', 'defect', 'medium', 'testing', [me], c, day(-2)),
  ...[7, 8, 9, 10].map(n => doc(n, `TODO-${n}`, `排期中的待办 ${n}`, 'todo', 'low', 'queued', [me], c, day(-3))),
  doc(11, 'REQ-30', '没人负责的需求', 'requirement', 'medium', 'queued', [], me, day(-2)),
  doc(12, 'BUG-12', '成员丙负责的缺陷', 'defect', 'low', 'doing', [c], b, day(-1)),
]
let docs = initial()
export function resetWorkbench() {
  docs = initial(); workbenchRequests.length = 0; workbenchControl.fail.clear(); workbenchControl.patch.length = 0
  workbenchControl.delay = 0; workbenchControl.readDelay = 0; workbenchControl.members = []; workbenchControl.completions = []
}
export const workbenchDocs = () => docs

const summary = item => ({ ...item.reporter })
function card(item) {
  const mine = item.assignees.some(user => user.id === me.id), verify = item.reporter.id === me.id && item.code === 'testing'
  return { id: item.id, key: item.key, title: item.title, documentType: item.documentType, priority: item.priority, status: statuses[item.code],
    reporter: summary(item), assignees: item.assignees, lastActivityAt: item.lastActivityAt, mine, verify }
}
function flow() {
  const cards = docs.filter(item => FLOW_STATES.includes(item.code)).map(card).filter(item => item.mine || item.verify)
  const mine = cards.filter(item => item.mine)
  return { asOf, me: { id: me.id, name: me.name }, statuses, cards, truncated: false,
    counts: { ...Object.fromEntries(FLOW_STATES.map(code => [code, mine.filter(item => item.status.code === code).length])),
      verify: cards.filter(item => item.verify).length, stale: mine.filter(item => staleLevel(item.status.code, item.lastActivityAt, asOf)).length } }
}
function teamLoad() {
  const count = test => Object.fromEntries(FLOW_STATES.map(code => [code, docs.filter(item => item.code === code && test(item)).length]))
  return { asOf, statuses: FLOW_STATES.map(code => statuses[code]), rows: [
    ...[...users, ...workbenchControl.members].map(user => ({ ...user, counts: count(item => item.assignees.some(person => person.id === user.id)) })),
    { id: 'unassigned', name: '未指派', avatarColor: null, counts: count(item => !item.assignees.length) },
  ] }
}

const kinds = ['status', 'assignee', 'create', 'revision', 'priority']
// 45 条动态跨今天、昨天和更早，第一页 30 条，滚动后读取剩余部分。
const events = Array.from({ length: 45 }, (_, index) => {
  const kind = kinds[index % kinds.length], target = initial()[index % 6], at = index < 6 ? day(0, `0${6 - index}:10`) : index < 12 ? day(-1, '08:00') : day(-2 - index, '03:00')
  return { id: `event-${index}`, kind, at, actor: index % 3 ? b : me, mine: index % 4 === 0,
    document: { id: target.id, key: target.key, title: target.title, documentType: target.documentType },
    ...(kind === 'status' ? { from: { label: '待处理', color: statuses.queued.color }, to: { label: '进行中', color: statuses.doing.color } } : {}),
    ...(kind === 'priority' ? { from: { label: '低', color: null }, to: { label: '高', color: null } } : {}),
    ...(kind === 'assignee' ? { assignees: index % 2 ? [{ id: me.id, name: me.name }] : [] } : {}),
    ...(kind === 'revision' ? { version: 2 + index % 3 } : {}) }
})
function activity(query) {
  const rows = events.filter(item => !query.kind || query.kind === 'all' || item.kind === query.kind)
  const start = query.cursor ? Number(query.cursor) : 0, limit = Number(query.limit ?? 30)
  return { asOf, items: rows.slice(start, start + limit), nextCursor: start + limit < rows.length ? String(start + limit) : null }
}

const dataStart = shiftDay(completionWindowStart(today), 20)
function completions(query) {
  const scope = query.scope ?? 'team'
  const items = [...Array.from({ length: 18 }, (_, index) => {
    const date = shiftDay(today, -((index * 3) % 60)), target = initial()[index % 12]
    return { id: `done-${index}`, key: `DONE-${index}`, title: `完成的文档 ${index}`, documentType: target.documentType, date, completedAt: `${date}T04:00:00.000Z`, mine: index % 3 === 0 }
  }), ...workbenchControl.completions].filter(item => item.date >= dataStart && (scope === 'team' || item.mine)).map(({ mine, ...item }) => item)
  return { asOf, scope, today, startDate: completionWindowStart(today), dataStart, items }
}

function failure(statusCode, message, data) { return Object.assign(new Error(message), { statusCode, data: { statusCode, message, data } }) }
async function patch(id, body) {
  const item = docs.find(row => row.id === id)
  if (workbenchControl.delay) await new Promise(resolve => setTimeout(resolve, workbenchControl.delay))
  const outcome = workbenchControl.patch.shift()
  if (outcome === 'error') throw new Error('网络中断')
  if (outcome === 'locked') throw failure(423, '需求已由 成员乙 的 AI 锁定，当前只能查看')
  const target = Object.values(statuses).find(status => status.id === body.statusId)
  if (outcome === 'conflict' || statuses[item.code].id !== body.expectedStatusId) {
    if (outcome === 'conflict') item.code = 'closed'
    throw failure(409, `状态已被他人改为「${statuses[item.code].name}」，本次修改未提交`, { code: 'STATUS_CONFLICT', currentStatus: statuses[item.code] })
  }
  item.code = target.code; item.lastActivityAt = asOf
  return { id }
}

export function workbenchFetch(url, options) {
  const query = options.query ?? {}
  if (url.startsWith('/api/workbench/')) {
    const name = url.slice('/api/workbench/'.length)
    workbenchRequests.push({ name, query: { ...query } })
    const read = () => {
      if (workbenchControl.fail.has(name)) { workbenchControl.fail.delete(name); return Promise.reject(new Error(`${name} 暂时不可用`)) }
      if (name === 'flow') return flow()
      if (name === 'activity') return activity(query)
      if (name === 'team-load') return teamLoad()
      if (name === 'completions') return completions(query)
    }
    return workbenchControl.readDelay ? new Promise(resolve => setTimeout(resolve, workbenchControl.readDelay)).then(read) : read()
  }
  if (options.method === 'PATCH' && /^\/api\/requirements\/flow-\d+$/.test(url)) {
    workbenchRequests.push({ name: 'patch', id: url.split('/').at(-1), body: options.body })
    return patch(url.split('/').at(-1), options.body)
  }
  return undefined
}
