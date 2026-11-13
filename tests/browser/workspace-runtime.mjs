import { computed, reactive, ref, watch } from 'vue'
import { bingToast } from '@moubing/bing-ui'
import { revisionEditors } from '../../shared/requirements/revisions'
import { createSelectionHistoryContextToken, writeSelectionHistoryTabContext } from '../../app/components/diff/selection-history-tab-context'
import { extractSelectionHistoryBlocks } from '../../shared/diff/selection-history'
import { searchRequirements } from '../../app/utils/requirement-search'
import { compareRequirementText, requirementAssigneeSortText } from '../../shared/requirements/search'
import { resetWorkbench, workbenchControl, workbenchDocs, workbenchFetch, workbenchRequests } from './workbench-fixture.mjs'
import { builtInTemplates } from '../../shared/documents/templates'
import { consumerAccountFetch, consumerAccounts } from './consumer-accounts-runtime.mjs'
export { useRecentRequirements } from '../../app/composables/use-recent-requirements'

// 只替换 Nuxt 数据和协作服务；页面、编辑器、Diff 与组件库均使用真实实现。
const headingLabels = [
  '产品概览与目标', '1. (bug)首页表格表头的鼠标提示',
  '2. (bug)编辑器的撤销与重做行为需要完整保留段落、列表和图片',
  '3. (bug)工具提示的空白', '4. (feat)让用户知道当前输入将继承的格式，并提供统一快捷键',
  '5. (feat)关闭拼写检查', '6. (feat)图片增加复制功能',
  '7. (feat)目录需要显示更多可读信息',
  '9. (feat)要改一下ui布局，现在两边的空隙有点大，显得有点挤。你看左边的目录那里，宽度给的太少了，那个目录根本就显示不了什么信息。',
]
function documentAt(version) {
  return { type: 'doc', content: headingLabels.flatMap((label, section) => [
    { type: 'heading', attrs: { diffId: `heading_${section}`, level: section === 0 ? 1 : 3 }, content: [{ type: 'text', text: label }] },
    ...Array.from({ length: 12 }, (_, index) => ({ type: 'paragraph', attrs: { diffId: `paragraph_${section}_${index}` },
      content: [{ type: 'text', text: `章节 ${section + 1} 的第 ${index + 1} 段：验收时应保留正文、阅读位置和输入状态。${index === 6 && section % 3 === 0 ? `本段内容来自版本 ${version}` : ''}` }] })),
  ]) }
}
const user = { id: 'fixture-user', name: '测试成员', avatarColor: '#3366cc' }
export const revisions = ref([3, 2, 1].map(version => ({
  id: `rev-${version}`, requirementId: 'fixture', version, title: '工作区布局优化', contentJson: documentAt(version), contentText: '',
  changeNote: version === 3 ? '调整目录宽度\n完善相邻版本比较与版本选项详情。' : version === 2 ? '' : '初始化需求',
  createdAt: `2026-10-0${version}T08:00:00.000Z`, author: user,
  attribution: version === 1 ? null : { version: 2, baseRevisionId: `rev-${version - 1}`, baseVersion: version - 1, nodes: [
    { id: 'heading_0', type: 'heading', unknown: version === 2, authors: [{ userId: 'editor-a', name: '编辑成员甲' }] },
    { id: 'paragraph_0_6', type: 'paragraph', unknown: false, authors: [
      { userId: 'editor-a', name: '编辑成员甲' }, { userId: 'editor-b', name: '编辑成员乙' },
    ] },
  ] },
})))
const summaries = computed(() => revisions.value.map(({ contentJson, contentText, attribution, ...metadata }) => ({
  ...metadata, ...revisionEditors(attribution),
})))
const status = { id: 'open', code: 'queued', name: '待处理', color: '#2f6fed' }
export const requirement = ref({ id: 'fixture', key: 'REQ-TEST', title: '工作区布局优化', priority: 'high',
  statusId: status.id, status, assigneeIds: [user.id], assignees: [user], reporter: user, currentRevision: revisions.value[0] })
const meta = ref({ project: { id: 'fixture-project', name: '文档看板' }, currentUserId: user.id,
  users: [user, { id: 'member-b', name: '成员乙', avatarColor: '#993366' }, { id: 'member-c', name: '成员丙', avatarColor: '#669933' }],
  statuses: [status, { id: 'doing', code: 'doing', name: '进行中', color: '#c15d2b' }, { id: 'testing', code: 'testing', name: '测试中', color: '#0891b2' },
    { id: 'done', code: 'done', name: '已完成', color: '#198754' }, { id: 'closed', code: 'closed', name: '已关闭', color: '#667085' }] })
const boardRequirements = ref(Array.from({ length: 6 }, (_, i) => ({ ...requirement.value,
  id: i ? `fixture-${i}` : 'fixture', key: `REQ-${12 - i}`, documentType: i < 4 ? 'requirement' : 'instruction',
  title: ['工作区布局优化', '完善文档的状态流转', '编辑器图片与表格交互', '文档目录与版本比较', '项目成员与角色说明', '共同编辑使用指南'][i],
  assigneeIds: i === 0 ? [user.id] : [], assignees: i === 0 ? [user] : [],
  updatedAt: '2026-10-05T08:00:00Z', createdAt: '2026-10-04T08:00:00Z',
})))
const defaultTemplates = builtInTemplates()
const templates = ref([...defaultTemplates, {
  ...defaultTemplates[2], id: 'template-project', name: '发布概述', description: '整理本次发布内容与使用说明。', builtIn: false, canEdit: true, version: 2,
}])
const managedUsers = ref([{ ...user, email: 'member@example.com', projectRoles: ['project_admin'], banned: false },
  ...Array.from({ length: 11 }, (_, index) => ({ ...user, id: `fixture-member-${index + 2}`, name: `协作成员 ${index + 2}`,
    email: `member${index + 2}@example.com`, projectRoles: [index % 2 ? 'qa' : 'developer'], banned: false })),
])
const accessRequests = ref([{ id: 'request-fixture', user: { ...user, id: 'applicant', name: '申请成员', email: 'applicant@example.com' }, message: '加入项目', status: 'pending', reviewNote: '', reviewedAt: null, createdAt: '2026-10-19T00:00:00Z' }])
export const draft = Object.fromEntries(Object.entries({
  ready: true, restoring: false, busy: false, navigationPending: false, navigationError: '', readOnly: false, editorKey: 'fixture-editor',
  uploads: [], editorOptions: undefined, agentLock: null, canReleaseLock: false, releasingLock: false, lockError: '',
  epochConflict: false, pendingEdits: 0, participants: [{ ...user, color: '#3366cc' }], connection: 'connected',
  cloudTime: '', localTime: '', cloudError: '', localError: '', recoveryError: '', needsBackup: false,
  syncing: false, status: '草稿已同步', canRetry: true, editEpoch: 0,
}).map(([key, value]) => [key, ref(value)]))
let editorOptions
Object.assign(draft, {
  ensureServerDraft: async () => 'fixture-draft', setUploads() {}, attributionSnapshot: () => null,
  flushEdits: async () => { if (draft.cloudError.value) throw new Error(draft.cloudError.value); draft.pendingEdits.value = 0 },
  async releaseLock() {
    draft.releasingLock.value = true
    try { await operationWait('release-lock'); draft.agentLock.value = null }
    finally { draft.releasingLock.value = false }
  },
  exportRecoveryAndReload() { draft.epochConflict.value = false }, collaborationUpdate: () => undefined,
  retry() { draft.cloudError.value = ''; draft.localError.value = ''; draft.recoveryError.value = '' },
  prepareVersion: async () => { await operationWait('prepare-version'); return { draftId: 'fixture-draft', snapshot: { title: editorOptions.title.value,
    contentJson: editorOptions.content.value, changeNote: editorOptions.changeNote.value, pendingUploads: [] } } },
  versionSaved() {},
})
export function useRequirementCollaboration(options) { editorOptions = options; return { ...draft, prepareResume() {} } }
const loginPage = new URLSearchParams(location.search).get('panel') === 'login'
const routeState = reactive({ params: { id: 'fixture' }, path: loginPage ? '/login' : ({ dashboard: '/', documents: '/requirements', templates: '/templates', members: '/members' })[new URLSearchParams(location.search).get('page')] ?? '/requirements/fixture', fullPath: location.pathname + location.search, query: Object.fromEntries(new URLSearchParams(location.search)) })
export const useRoute = () => routeState
export const useRouter = () => ({ currentRoute: ref(routeState), resolve: target => ({ fullPath: target.path }), push: async () => undefined,
  replace: async ({ query }) => { routeState.query = query; history.replaceState(null, '', `${location.pathname}?${new URLSearchParams(query)}`) } })
export function onBeforeRouteLeave() {}
export function navigateTo(path) {
  fixture.navigationRequests.push(path)
  if (operations.failures.navigation) { operations.failures.navigation--; throw new Error('导航暂不可用') }
}
export function definePageMeta() {}
export function useHead() {}
const states = new Map()
const fixtureApp = {}
export const useNuxtApp = () => fixtureApp
const relatedDocuments = ref([boardRequirements.value[2]])
let relationFailure = false
export function useState(key, init) {
  if (!states.has(key)) states.set(key, ref(init()))
  return states.get(key)
}
export function useCookie(key, options) {
  const raw = document.cookie.split('; ').find(entry => entry.startsWith(`${key}=`))?.slice(key.length + 1)
  let initial
  try { initial = raw ? JSON.parse(decodeURIComponent(raw)) : options.default() }
  catch { initial = options.default() }
  const cookie = ref(initial)
  if (options.watch !== false) watch(cookie, value => { document.cookie = `${key}=${encodeURIComponent(JSON.stringify(value))};path=/;max-age=${options.maxAge}` }, { flush: 'sync' })
  return cookie
}
export function useRequirementReadingPosition() {}
const metadataRequests = []
export const useRequirementWorkspace = () => useState('requirement-workspace', () => ({ id: '', locked: false, error: '' }))
export const useAccountAccessState = () => useState('account-access', () => loginPage || new URLSearchParams(location.search).has('initialAccountLoading') ? null : structuredClone(consumerAccounts.access))
export const useAuthSessionState = () => ref({ user: { ...user, email: 'member@example.com', role: 'admin' } })
export const useAsyncData = async (key, handler) => {
  const data = ref(null), pending = ref(false), error = ref(null)
  const refresh = async () => {
    pending.value = true
    try { data.value = await handler(); error.value = null }
    catch (cause) { error.value = cause }
    finally { pending.value = false }
  }
  await refresh()
  return { data, pending, error, refresh }
}
const revisionHistoryRequests = []
export async function useFetch(input, options = {}) {
  const url = typeof input === 'function' ? input() : input
  const fullHistory = url.endsWith('/revisions') && options.query?.includeContent === 'true'
  const data = fullHistory ? ref(null) : url.endsWith('/related') ? relatedDocuments : url === '/api/document-templates' ? templates : url === '/api/meta' ? meta : url.endsWith('/revisions') ? summaries : requirement
  const pending = ref(false)
  const error = ref(null)
  async function execute() {
    metadataRequests.push({ url, method: 'GET' })
    pending.value = true
    try {
      await operationWait(`refresh:${url}`)
      if (fullHistory) { revisionHistoryRequests.push(url); data.value = revisions.value }
      error.value = null
    } catch (cause) { error.value = cause }
    finally { pending.value = false }
  }
  if (options.immediate !== false) await execute()
  return { data, pending, error, refresh: execute, execute }
}
const operations = { delays: {}, failures: {}, loseResponses: {}, requests: [] }
if (new URLSearchParams(location.search).has('initialAccountLoading')) operations.delays['GET:/api/account/access'] = 800
if (new URLSearchParams(location.search).has('slowTokens')) operations.delays['GET:/api/account/agent-tokens'] = 800
if (new URLSearchParams(location.search).has('failTokens')) operations.failures['GET:/api/account/agent-tokens'] = 1
const writeReceipts = new Map()
async function operationWait(key) {
  if (operations.delays[key]) await new Promise(resolve => setTimeout(resolve, operations.delays[key]))
  if (operations.failures[key]) { operations.failures[key]--; throw new Error('模拟请求失败') }
}
const revisionRequests = [], revisionFailures = new Set()
let metadataFailure = false
export const useRequestFetch = () => $fetch
export const useRequestURL = () => new URL(location.href)
export async function $fetch(url, options = {}) {
  const operationKey = `${options.method ?? 'GET'}:${url}`
  const original = JSON.parse(JSON.stringify(requirement.value))
  if (options.method) operations.requests.push({ key: operationKey, body: options.body, headers: options.headers })
  await operationWait(operationKey)
  if (url.startsWith('/api/account/') || url === '/api/admin/invitations') return consumerAccountFetch(url, options)
  if (url === '/api/requirements/fixture' && !options.method) { metadataRequests.push({ url, method: 'GET' }); return original }
  if (url === '/api/requirements/fixture/revisions' && options.method === 'POST') {
    if (writeReceipts.has(options.body.clientSaveId)) return writeReceipts.get(options.body.clientSaveId)
    const created = { ...revisions.value[0], id: `rev-${revisions.value.length + 1}`, version: revisions.value.length + 1,
      title: requirement.value.title, contentJson: options.body.contentJson, changeNote: options.body.changeNote }
    revisions.value.unshift(created)
    writeReceipts.set(options.body.clientSaveId, created)
    if (operations.loseResponses[operationKey]) { operations.loseResponses[operationKey]--; throw new Error('请求超时，响应丢失') }
    return created
  }
  if (url === '/api/requirements' && options.method === 'POST') {
    const key = options.headers?.['Idempotency-Key']
    if (writeReceipts.has(key)) return writeReceipts.get(key)
    const created = { ...requirement.value, ...options.body, id: `created-${boardRequirements.value.length}`, key: 'REQ-NEW' }
    boardRequirements.value.push(created); writeReceipts.set(key, created)
    if (operations.loseResponses[operationKey]) { operations.loseResponses[operationKey]--; throw new Error('请求超时，响应丢失') }
    return created
  }
  if (url === '/api/meta') return meta.value
  if (url === '/api/members') return managedUsers.value
  if (url === '/api/admin/requests') return { items: accessRequests.value, total: accessRequests.value.length, page: 1, limit: 20 }
  if (url === '/api/admin/requests/request-fixture/review') {
    accessRequests.value[0] = { ...accessRequests.value[0], status: options.body.decision === 'approve' ? 'approved' : 'rejected', reviewNote: options.body.note }
    return accessRequests.value[0]
  }
  if (url === '/api/admin/users') return { items: managedUsers.value, total: managedUsers.value.length, page: 1, limit: 20 }
  if (url.startsWith('/api/admin/users/')) {
    const target = managedUsers.value.find(item => item.id === url.split('/')[4])
    if (!options.method) return { user: { ...target, role: 'user', isMember: true, createdAt: '2026-10-19T00:00:00Z' }, audit: [] }
    if (options.method === 'PATCH') Object.assign(target, options.body)
    else if (url.endsWith('/status')) target.banned = options.body.disabled
    return { ...target }
  }
  const workbench = workbenchFetch(url, options)
  if (workbench !== undefined) return workbench
  if (['/api/requirements', '/api/requirements/groups', '/api/requirements/search', '/api/requirements/summaries'].includes(url)) {
    metadataRequests.push({ url, method: 'GET', query: options.query })
    const query = options.query ?? {}
    const all = boardRequirements.value.map(item => item.id === requirement.value.id ? { ...item, title: requirement.value.title } : item)
    if (url.endsWith('/summaries')) return { items: query.ids.flatMap(id => all.filter(item => item.id === id)),
      requestedIds: query.ids, unavailableIds: query.ids.filter(id => !all.some(item => item.id === id)), complete: true, asOf: 'now' }
    let rows = searchRequirements(all, query.q ?? '', (query.recentIds ?? []).map((id, i) => ({ id, visitedAt: 100 - i }))).filter(row =>
      (!query.documentType || row.documentType === query.documentType) && (!query.statusId || row.status.id === query.statusId)
      && (!query.excludeId || row.id !== query.excludeId) && (!query.assignee || (query.assignee === 'unassigned' ? !row.assigneeIds.length : row.assigneeIds.includes(query.assignee === 'me' ? user.id : query.assignee))))
    if (url.endsWith('/search')) return { items: rows.slice(0, query.limit ?? 20), hasMore: rows.length > (query.limit ?? 20), asOf: 'now' }
    if (url.endsWith('/groups')) return { groups: meta.value.statuses.map(status => ({ ...status, count: rows.filter(row => row.status.id === status.id).length })), total: rows.length, asOf: 'now' }
    if (query.sortBy) {
      const value = row => query.sortBy === 'key' ? Number(row.key.split('-')[1]) : query.sortBy === 'status' ? row.status.name : query.sortBy === 'assignees' ? requirementAssigneeSortText(row.assignees) : row[query.sortBy]
      rows = [...rows].sort((a, b) => (query.sortOrder === 'desc' ? -1 : 1) * (typeof value(a) === 'number' ? value(a) - value(b) : compareRequirementText(String(value(a)), String(value(b)))) || compareRequirementText(a.id, b.id))
    }
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, asOf: 'now' }
  }
  if (url === '/api/requirements/fixture' && options.method === 'PATCH') {
    metadataRequests.push({ url, method: 'PATCH', body: options.body })
    if (metadataFailure) { metadataFailure = false; throw new Error('属性保存失败，请重试') }
    const { mutationId, ...properties } = options.body
    const updated = { ...original, ...properties,
      ...(properties.assigneeIds ? { assignees: [...new Map([...meta.value.users, ...original.assignees].map(item => [item.id, item])).values()].filter(item => properties.assigneeIds.includes(item.id)) } : {}),
      ...(properties.statusId ? { status: meta.value.statuses.find(item => item.id === properties.statusId) } : {}) }
    // 模拟服务器先广播，再返回 HTTP 响应。
    editorOptions.onProperties({ mutationId })
    return updated
  }
  if (url.startsWith('/api/requirements/fixture/related')) {
    if (relationFailure) { relationFailure = false; throw new Error('关联保存失败，请重试。') }
    const ids = new Set(relatedDocuments.value.map(item => item.id))
    if (options.method === 'POST') options.body.documentIds.forEach(id => ids.add(id))
    if (options.method === 'DELETE') ids.delete(decodeURIComponent(url.split('/').at(-1)))
    relatedDocuments.value = boardRequirements.value.filter(item => ids.has(item.id))
    return relatedDocuments.value
  }
  if (url.endsWith('/annotation-completions/ack')) {
    const completed = JSON.parse(localStorage.getItem('fixture-annotation-completions') ?? '[]')
    localStorage.setItem('fixture-annotation-completions', JSON.stringify(completed.filter(item => !options.body.annotations.some(note => note.id === item.id && note.fingerprint === item.fingerprint))))
    return { acknowledged: true }
  }
  if (url.endsWith('/annotation-completions')) {
    const completed = JSON.parse(localStorage.getItem('fixture-annotation-completions') ?? '[]')
    return { completed: completed.filter(item => options.body.annotations.some(note => note.id === item.id && note.fingerprint === item.fingerprint)) }
  }
  if (url.startsWith('/api/document-templates') && options.method) {
    const key = options.headers?.['Idempotency-Key']
    if (writeReceipts.has(key)) return writeReceipts.get(key)
    const id = options.method === 'PUT' ? url.split('/').at(-1) : `template-new-${templates.value.length}`
    const saved = { ...options.body, id, builtIn: false, canEdit: true, version: (options.body.version ?? 0) + 1 }
    templates.value = [saved, ...templates.value.filter(item => item.id !== id)]
    writeReceipts.set(key, saved)
    return saved
  }
  if (url === '/api/document-templates') return templates.value
  if (url.startsWith('/api/members/') && options.method === 'PUT') {
    const target = managedUsers.value.find(item => item.id === url.split('/')[3])
    target.projectRoles = options.body.roles
    return target
  }
  if (url.startsWith('/api/revisions/')) {
    const id = url.split('/').at(-1)
    revisionRequests.push(id)
    if (revisionFailures.delete(id)) throw new Error('测试正文加载失败')
    const revision = revisions.value.find(item => item.id === id)
    if (!revision) throw new Error('版本不存在')
    return revision
  }
  throw new Error('测试保存失败，请稍后重试。')
}
export const fixture = { draft, revisions, requirement, documentAt, document: () => editorOptions.content.value, navigationRequests: [],
  route: routeState,
  toasts: () => bingToast.getToasts(), clearToasts: () => bingToast.clear(),
  operations, meta, managedUsers, accessRequests, templates, consumerAccounts, useAccountAccessState, workspace: useRequirementWorkspace,
  workbenchControl, workbenchRequests, workbenchDocs, resetWorkbench,
  metadataRequests, failMetadata() { metadataFailure = true },
  notifyProperties(message = {}) { editorOptions.onProperties(message) },
  relatedDocuments, failRelation() { relationFailure = true }, resetRelations() { relatedDocuments.value = [boardRequirements.value[2]] },
  completeAnnotations(completed) { localStorage.setItem('fixture-annotation-completions', JSON.stringify(completed)); draft.editEpoch.value++ },
  revisionRequests, revisionHistoryRequests, failRevision(id) { revisionFailures.add(id) },
  createSelectionContext(draftDocument = documentAt(4), blockId = 'paragraph_0_6', range) {
    const token = createSelectionHistoryContextToken()
    const paragraph = extractSelectionHistoryBlocks(draftDocument).find(node => node.id === blockId)
    const start = range?.start ?? 0, end = range?.end ?? Array.from(paragraph.text).length
    const text = Array.from(paragraph.text).slice(start, end).join('')
    writeSelectionHistoryTabContext(localStorage, token, { requirementId: 'fixture', draftDocument,
      currentUserName: user.name, capturedAt: new Date().toISOString(),
      anchor: { scope: range ? 'selection' : 'block', text, segments: [{ blockId: paragraph.id, blockType: paragraph.type,
        start, end, text, wholeBlock: !range }] } })
    return token
  },
  setComparison(base, target) { revisions.value[0].contentJson = base; editorOptions.content.value = target },
  setError(message) { draft.navigationError.value = message }, setRecovery(value) { draft.epochConflict.value = value } }
