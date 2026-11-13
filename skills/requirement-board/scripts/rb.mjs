import { readFile, writeFile, stat, mkdtemp } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { listSites, loadConfiguration, normalizeOrigin } from './config.mjs'
import { cacheDocument, hydrateDocument, readCachedDocument } from './cache.mjs'
import { formatDiff, formatHistory, formatLog } from './format.mjs'
import { MAX_REQUEST_BYTES, parseAnnotationRequest, resolveAnnotationRequest, assertAnnotationCapabilities } from './annotations.mjs'
export { configuration } from './config.mjs'

export function requirementId(value, origin) {
  if (/^REQ-[1-9][0-9]*$/.test(value)) return value
  if (/^req_[a-zA-Z0-9_-]{1,100}$/.test(value)) return value
  const url = new URL(value)
  const match = /^\/requirements\/(req_[a-zA-Z0-9_-]{1,100})\/?$/.exec(url.pathname)
  if (url.origin !== origin || url.username || url.password || !match) throw new Error('需求链接必须属于 RB_BASE_URL 配置的站点，并指向需求详情页。')
  return match[1]
}

export async function request(config, path, body, method = body === undefined ? 'GET' : 'POST') {
  const multipart = body instanceof FormData
  const response = await fetch(new URL(`/api/agent/v1/${path}`, config.origin), {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${config.token}`, ...(body === undefined || multipart ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${data.message}`)
    error.detail = data.data
    throw error
  }
  if (typeof data.documentUrl === 'string') data.documentUrl = new URL(data.documentUrl, config.origin).href
  return data
}

function flag(options, name) {
  if (typeof options.get(name) !== 'string' || !options.get(name)) throw new Error(`缺少 ${name} 参数`)
  return options.get(name)
}

function parseArguments(argv) {
  const booleans = new Set(['--help', '--create', '--stat', '--json', '--full', '-t', '--takeover', '--stale'])
  const values = new Set(['--site', '--out', '--query', '--page', '--page-size', '--document-type', '--status-id', '--assignee', '--reporter', '--exclude-id', '--sort-by', '--sort-order', '--cursor', '--snapshot', '--annotations', '--file', '--from', '--to', '--limit', '--offset', '--comparison-token', '--version', '--text', '--at', '--block', '--start', '--upload-id', '--create-request'])
  const args = [], options = new Map()
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index]
    if (booleans.has(name)) options.set(name, true)
    else if (values.has(name)) {
      if (options.has(name)) throw new Error(`参数不能重复：${name}`)
      if (argv[index + 1] === undefined) throw new Error(`缺少 ${name} 参数`)
      // 选中文字和文件名是数据，即使恰好为 -t 或 --stat 也不能解释成开关。
      options.set(name, argv[++index])
    } else if (name.startsWith('-')) throw new Error(`未知参数：${name}`)
    else args.push(name)
  }
  return { args, options }
}

async function remember(config, document, alias) {
  try { await cacheDocument(config, document, alias) }
  catch { console.error('本机缓存未写入，下次将重新读取；服务端操作结果不受影响。') }
}

async function readAnnotations(file) {
  if ((await stat(file)).size > MAX_REQUEST_BYTES + 4096) throw new Error('标注请求文件过大。')
  return parseAnnotationRequest(await readFile(file, 'utf8'))
}

function documentOrigin(value) {
  if (value === undefined || /^REQ-[1-9][0-9]*$/.test(value) || /^req_[a-zA-Z0-9_-]{1,100}$/.test(value)) return undefined
  const url = new URL(value)
  const origin = normalizeOrigin(url.origin)
  requirementId(value, origin)
  return origin
}

function selectOrigin(options, ...hints) {
  const origins = [options.has('--site') ? flag(options, '--site') : undefined, ...hints]
    .filter(value => value !== undefined).map(normalizeOrigin)
  if (new Set(origins).size > 1) throw new Error('--site、文档链接或文件中的 siteOrigin 指向不同站点，未发送请求。请使用目标站点生成的快照和请求文件。')
  return origins[0]
}

const listFlags = { '--query': 'q', '--page': 'page', '--page-size': 'pageSize', '--document-type': 'documentType',
  '--status-id': 'statusId', '--assignee': 'assignee', '--reporter': 'reporter', '--exclude-id': 'excludeId', '--sort-by': 'sortBy', '--sort-order': 'sortOrder' }

async function requireCapability(config, capability) {
  const schema = await request(config, 'schema')
  if (!Number.isInteger(schema.capabilitiesVersion) || schema.capabilitiesVersion < 9 || !schema.capabilities?.includes(capability)) {
    throw new Error(`目标站点不支持 ${capability}（需要能力版本 9）。请按 Skill 更新流程更新一次并重新核验；仍不支持时需升级站点，不能降级执行。`)
  }
}

function paginatedResult(data, config, query) {
  if (Array.isArray(data)) throw new Error('目标站点返回旧版裸数组，无法确认总数或继续翻页；请升级站点和 Skill，不能将此结果视为全部。')
  if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0
    || !Number.isSafeInteger(data.page) || data.page < 1 || !Number.isInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 100
    || !Number.isSafeInteger((data.page - 1) * data.pageSize) || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf))
    || data.page !== Number(query.get('page')) || data.pageSize !== Number(query.get('pageSize'))
    || data.items.length !== Math.min(data.pageSize, Math.max(0, data.total - (data.page - 1) * data.pageSize))) {
    throw new Error('分页响应无效，无法确认是否已查全，请重试当前页。')
  }
  const hasMore = data.items.length > 0 && data.page < Math.ceil(data.total / data.pageSize)
  return { ...data, hasMore, nextPage: hasMore ? data.page + 1 : null, siteOrigin: config.origin }
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args)
  args = parsed.args
  const options = parsed.options
  const takeover = options.has('-t') || options.has('--takeover')
  const command = args[0]
  if (!command || options.has('--help')) {
    console.log('rb.mjs schema [--out schema.json]\nrb.mjs meta\nrb.mjs list [--query 关键词]\nrb.mjs read <文档> [--out document.json | --full]\nrb.mjs status <文档>\nrb.mjs diff <文档> [--from latest|vN --to draft|vN] [--stat] [--json] [--limit 30 --offset 0 --comparison-token 标识]\nrb.mjs log <文档> [--json]\nrb.mjs show <文档> --version vN --out revision.json\nrb.mjs history <文档> --text 文本 [--at vN --block 块ID --start 字符位置] [--json]\nrb.mjs upload-image <文档> --file 图片路径 [--upload-id 固定ID]\nrb.mjs upload-image --create-request 新建requestId --file 图片路径\nrb.mjs revisions <文档>\nrb.mjs revision <rev_id> --out revision.json\nrb.mjs property-history <文档> [--cursor audit_id]\nrb.mjs snapshot <文档> [--out snapshot.json | --full]\nrb.mjs renew --snapshot snapshot.json\nrb.mjs release --snapshot snapshot.json\nrb.mjs new --snapshot snapshot.json --out action.json\nrb.mjs new --create --out action.json\nrb.mjs validate --file action.json\nrb.mjs submit --file action.json\nrb.mjs operation <operation_id> [--out detail.json]\nread/snapshot 命中缓存时默认省略正文；--full 输出全文，--out 始终保存完整结果。')
    console.log('rb.mjs annotations --file 标注请求.md --snapshot snapshot.json [--out resolved.json]（只定位，不写入）')
    console.log('rb.mjs read-image <文档> --block <图片节点ID> [--snapshot snapshot.json] [--out 原图路径]（只读；按需查看，完成后清理）')
    console.log('rb.mjs new --snapshot snapshot.json --annotations 标注请求.md --out action.json（核验定位并携带完成回执）')
    console.log('rb.mjs sites（仅列出已配置站点，不显示凭证）\n所有业务命令支持 --site <origin>；完整文档链接和新生成的快照/请求文件自动选择对应站点。')
    console.log('rb.mjs list [--query 关键词] [--page 1 --page-size 20] [--document-type requirement|defect|instruction|todo] [--status-id 状态ID] [--assignee me|unassigned|成员ID] [--reporter me|成员ID] [--stale] [--exclude-id 文档内部ID] [--sort-by key|title|documentType|status|priority|assignees|reporter|createdAt|updatedAt --sort-order asc|desc]')
    console.log('list 返回 items/total/page/pageSize/asOf/hasMore/nextPage；需要全部时保持条件继续翻页，跨页按 ID 去重。失败页重试，不能把已读部分当作全部。')
    console.log('rb.mjs related <文档>\nrb.mjs link <文档> <目标文档...>（1–100 个输入，增量添加）\nrb.mjs unlink <文档> <目标文档>（仅解除一条关系）\n关联命令接受编号、内部 ID 或同站点链接；不申请正文锁，不保存版本。写入响应不明时先 related 核对，再按仍有效的用户意图重试。')
    return
  }
  if (takeover && command !== 'submit') throw new Error('--takeover/-t 仅用于 submit；只读及准备命令无需接管参数。')
  if (options.has('--full') && command !== 'read' && command !== 'snapshot') throw new Error('--full 仅用于 read/snapshot，控制是否向终端输出缓存正文。')
  if (options.has('--annotations') && (command !== 'new' || options.has('--create'))) throw new Error('--annotations 仅用于 new --snapshot 的标注修改。')
  const relationCommand = ['related', 'link', 'unlink'].includes(command)
  if (command === 'list' || relationCommand) {
    const allowed = new Set(['--site', '--out', '--json', ...(command === 'list' ? [...Object.keys(listFlags), '--stale'] : [])])
    for (const name of options.keys()) if (!allowed.has(name)) throw new Error(`${command} 不支持参数 ${name}`)
    if (command === 'list' && args.length !== 1) throw new Error('list 请使用 --query 指定关键词')
    if (command === 'related' && args.length !== 2) throw new Error('related 需要一篇源文档')
    if (command === 'link' && (args.length < 3 || args.length > 102)) throw new Error('link 需要一篇源文档和 1–100 个目标输入')
    if (command === 'unlink' && args.length !== 3) throw new Error('unlink 需要一篇源文档和一个目标')
  }
  if (command === 'sites') { console.log(JSON.stringify(await listSites(), null, 2)); return }
  if (command === 'new' && options.has('--create') && options.has('--snapshot')) throw new Error('--create 与 --snapshot 不能同时使用')
  const snapshot = ['annotations', 'renew', 'release'].includes(command) || (command === 'new' && !options.has('--create')) || (command === 'read-image' && options.has('--snapshot'))
    ? JSON.parse(await readFile(flag(options, '--snapshot'), 'utf8')) : undefined
  const proposal = command === 'validate' || command === 'submit' ? JSON.parse(await readFile(flag(options, '--file'), 'utf8')) : undefined
  const annotations = command === 'annotations' ? await readAnnotations(flag(options, '--file'))
    : options.has('--annotations') ? await readAnnotations(flag(options, '--annotations')) : undefined
  const hasDocument = relationCommand || ['read', 'snapshot', 'revisions', 'log', 'property-history', 'diff', 'show', 'history', 'upload-image', 'read-image'].includes(command)
    || (command === 'status' && !args[1]?.startsWith('suggestion_'))
  const targetOrigin = selectOrigin(options, hasDocument ? documentOrigin(args[1]) : undefined,
    snapshot?.siteOrigin, proposal?.siteOrigin, annotations?.document.origin,
    ...(relationCommand ? args.slice(2).map(documentOrigin) : []))
  let result
  if (command === 'new') {
    if (options.has('--create')) {
      const siteOrigin = targetOrigin ?? (await loadConfiguration()).origin
      result = { siteOrigin, action: 'create', requestId: randomUUID(), title: '', contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, properties: {}, changeNote: '' }
    } else {
      if (snapshot.schemaVersion !== 3 || !/^snap_[a-zA-Z0-9_-]{16,64}$/.test(snapshot.id)) throw new Error('需要 schema 3 的最新快照，请升级站点和 Skill 后重新读取需求。')
      result = { ...(targetOrigin ? { siteOrigin: targetOrigin } : {}), snapshotId: snapshot.id, requestId: randomUUID(), changeNote: '', operations: [] }
      if (annotations) {
        const config = await loadConfiguration(process.env, targetOrigin)
        const schema = await request(config, 'schema')
        assertAnnotationCapabilities(annotations, schema)
        const resolved = resolveAnnotationRequest(annotations, snapshot, config.origin)
        if (!resolved.ready) throw new Error(resolved.annotations.flatMap((note, index) => note.status === 'unresolved' ? [`标注 ${index + 1}：${note.reason}`] : []).join('\n'))
        if (annotations.completion) result.completedAnnotations = annotations.completion
      }
    }
    // Never overwrite a request whose requestId may already have been executed.
    await writeFile(flag(options, '--out'), JSON.stringify(result, null, 2), { flag: 'wx' })
    console.log('已创建请求文件，请填写正文操作、属性及变更说明后校验；新建文档请填写 title 和 contentJson。')
    return
  }
  const config = await loadConfiguration(process.env, targetOrigin)
  if (command === 'annotations') {
    requirementId(annotations.document.id, config.origin)
    result = resolveAnnotationRequest(annotations, snapshot, config.origin)
  }
  else if (command === 'schema') result = await request(config, 'schema')
  else if (command === 'read-image') {
    const id = requirementId(args[1], config.origin), block = flag(options, '--block')
    if (!block || block.length > 100) throw new Error('图片节点 ID 无效')
    if (snapshot && snapshot.requirementId !== id) throw new Error('原图快照与文档身份不一致，请使用完整内部文档链接。')
    const query = snapshot ? `?${new URLSearchParams({ snapshotId: snapshot.id })}` : ''
    const response = await fetch(new URL(`/api/agent/v1/requirements/${encodeURIComponent(id)}/images/${encodeURIComponent(block)}${query}`, config.origin), {
      headers: { authorization: `Bearer ${config.token}` }, redirect: 'error', signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) { const data = await response.json(); throw new Error(`HTTP ${response.status}: ${data.message}`) }
    const mime = response.headers.get('content-type')?.split(';')[0]
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime]
    if (!extension) { await response.body?.cancel(); throw new Error('原图接口返回了不支持的文件类型') }
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 5 * 1024 * 1024) throw new Error('原图超过 5 MiB')
        chunks.push(value)
      }
    } finally { await reader.cancel() }
    if (!size) throw new Error('原图文件为空')
    const path = options.has('--out') ? resolve(flag(options, '--out')) : join(await mkdtemp(join(tmpdir(), 'rb-image-')), `original.${extension}`)
    await writeFile(path, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ path, mimeType: mime, bytes: size, siteOrigin: config.origin,
      limitations: response.headers.get('x-rb-image-first-frame-only') === 'true' ? ['动图仅保证首帧查看，动画要求需另行核验'] : [],
      cleanup: '任务结束后清理本次下载文件；下载成功不代表已取得视觉依据。' }, null, 2))
    return
  }
  else if (command === 'meta') result = await request(config, command)
  else if (command === 'list') {
    await requireCapability(config, 'paginated_search')
    const query = new URLSearchParams({ page: '1', pageSize: '20' })
    for (const [name, key] of Object.entries(listFlags)) if (options.has(name)) query.set(key, flag(options, name))
    if (options.has('--stale')) query.set('stale', '1')
    result = paginatedResult(await request(config, `requirements?${query}`), config, query)
  }
  else if (relationCommand) {
    const [id, ...documentIds] = args.slice(1).map(value => requirementId(value, config.origin))
    await requireCapability(config, 'document_relations')
    const path = `requirements/${encodeURIComponent(id)}/related`
    const documents = command === 'related' ? await request(config, path)
      : command === 'link' ? await request(config, path, { documentIds })
      : await request(config, `${path}/${encodeURIComponent(documentIds[0])}`, undefined, 'DELETE')
    result = documents.map(document => ({ ...document, documentUrl: new URL(`/requirements/${encodeURIComponent(document.id)}`, config.origin).href }))
  }
  else if (command === 'read' || command === 'snapshot' || (command === 'status' && !args[1]?.startsWith('suggestion_'))) {
    const id = requirementId(args[1], config.origin)
    const cached = await readCachedDocument(config, id)
    const condition = cached ? { ifContentToken: cached.contentToken } : {}
    const suffix = cached ? `?${new URLSearchParams(condition)}` : ''
    result = command === 'snapshot' ? await request(config, `requirements/${id}/snapshot`, condition)
      : await request(config, `requirements/${id}${command === 'status' ? '/status' : ''}${suffix}`)
    if (command !== 'status') {
      // REQ 编号可能在删除/重建后指向新文档，即便正文签名恰好相同也重新取全文。
      if (result.notModified && (!cached || (result.requirementId ?? result.id) !== cached.id || result.contentToken !== cached.contentToken)) {
        result = command === 'snapshot' ? await request(config, `requirements/${id}/snapshot`, {}) : await request(config, `requirements/${id}`)
      }
      result = hydrateDocument(result, cached)
      result.siteOrigin = config.origin
      await remember(config, result, id)
    } else result.cache = cached ? (result.notModified && result.id === cached.id ? 'current' : 'stale') : 'missing'
  }
  else if (command === 'revisions' || command === 'log' || command === 'property-history') {
    const path = `requirements/${requirementId(args[1], config.origin)}/${command === 'log' ? 'revisions' : command}`
    result = await request(config, path + (options.has('--cursor') ? `?cursor=${encodeURIComponent(flag(options, '--cursor'))}` : ''))
  }
  else if (command === 'revision') {
    if (!/^rev_[a-zA-Z0-9_-]{1,100}$/.test(args[1])) throw new Error('版本 ID 无效')
    result = await request(config, `revisions/${args[1]}`)
  }
  else if (command === 'diff' || command === 'show' || command === 'history') {
    const query = new URLSearchParams()
    const flags = command === 'diff' ? ['from', 'to', 'offset', 'limit', 'comparison-token'] : command === 'show' ? ['version'] : ['text', 'at', 'block', 'start']
    for (const name of flags) if (options.has(`--${name}`)) query.set(name === 'comparison-token' ? 'comparisonToken' : name, flag(options, `--${name}`))
    if (command === 'diff' && options.has('--stat')) query.set('stat', 'true')
    result = await request(config, `requirements/${requirementId(args[1], config.origin)}/${command}?${query}`)
  }
  else if (command === 'upload-image') {
    const file = flag(options, '--file')
    const info = await stat(file)
    if (!info.isFile() || info.size <= 0 || info.size > 5 * 1024 * 1024) throw new Error('请选择不超过 5 MiB 的图片文件')
    const bytes = await readFile(file)
    const target = options.has('--create-request') ? { createRequestId: flag(options, '--create-request') } : { requirementId: requirementId(args[1], config.origin) }
    if (target.createRequestId && args[1]) throw new Error('文档和 --create-request 不能同时指定')
    const uploadId = options.has('--upload-id') ? flag(options, '--upload-id') : createHash('sha256').update(JSON.stringify(target)).update(bytes).digest('hex')
    const form = new FormData()
    form.append('file', new Blob([bytes]), basename(file))
    result = await request(config, `assets/upload?${new URLSearchParams({ ...target, uploadId })}`, form)
  }
  else if (command === 'renew' || command === 'release') {
    if (!/^snap_[a-zA-Z0-9_-]{16,64}$/.test(snapshot.id)) throw new Error('快照 ID 无效')
    result = await request(config, `requirements/${requirementId(snapshot.requirementId, config.origin)}/lock`,
      { snapshotId: snapshot.id, action: command })
  }
  else if (command === 'validate' || command === 'submit') {
    // siteOrigin 是本机路由信息，不能进入服务端的严格操作协议或幂等内容。
    const { siteOrigin: _, ...payload } = proposal
    result = await request(config, command === 'validate' ? 'operations/validate' : 'operations', payload)
    if (command === 'submit' && result.document) {
      await remember(config, result.document)
      // 完整服务端正文保存在缓存；默认输出执行回执，避免再向模型重复输出全文。
      if (!options.has('--out')) result = { ...result, document: { id: result.document.id, contentToken: result.document.contentToken } }
    }
  } else if (command === 'operation' || command === 'status') {
    if (!/^suggestion_[a-zA-Z0-9_-]{16,64}$/.test(args[1])) throw new Error('操作 ID 无效')
    result = await request(config, `operations/${args[1]}`)
    if (result.document) {
      await remember(config, result.document)
      if (!options.has('--out')) result = { ...result, document: { id: result.document.id, contentToken: result.document.contentToken } }
    }
  } else throw new Error('未知命令，请使用 --help')
  if (options.has('--out')) {
    await writeFile(flag(options, '--out'), JSON.stringify(result, null, 2), 'utf8')
    console.log(result.cacheReused ? '正文未变化，已复用本机缓存；最新状态和完整正文已写入指定文件。' : '响应已保存到指定文件。')
  } else if ((command === 'read' || command === 'snapshot') && result.cacheReused && !options.has('--full')) {
    const { contentJson: _, ...summary } = result
    console.log(JSON.stringify({ ...summary, contentOmitted: true,
      contentHint: '正文未变化，已省略缓存全文；需要正文时加 --full，或用 --out <文件> 保存完整结果后按需读取。新会话不能仅凭缓存命中假定已阅读正文。',
    }, null, 2))
  } else if (command === 'validate') console.log(JSON.stringify({ valid: result.valid, schemaVersion: result.schemaVersion }))
  else if (!options.has('--json') && command === 'diff') console.log(formatDiff(result))
  else if (!options.has('--json') && command === 'log') console.log(formatLog(result))
  else if (!options.has('--json') && command === 'history') console.log(formatHistory(result))
  else console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message)
    if (error.detail) console.error(JSON.stringify(error.detail))
    process.exitCode = 1
  })
}
