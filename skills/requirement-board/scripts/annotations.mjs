// 浏览器与 Skill 共用；坐标采用 Unicode 码点，禁止按旧偏移猜测已变化的原文。
import { resolveObjectTarget, resolveNodeTarget, validateNodeTarget, stableJson } from './annotation-objects.mjs'
import { annotationNodeCapabilities, nodeAnnotationCapability } from './annotation-node-capabilities.mjs'
export { captureObjectTarget, captureNodeTarget, nodeContentSignature, objectContentSignature, objectTargetLabel, objectTargetPresentation, objectTargetNodeType, tableCellRanges } from './annotation-objects.mjs'
export { annotationNodeCapabilities, createAnnotationNodeRegistry, nodeAnnotationCapability, annotationNodeManifest } from './annotation-node-capabilities.mjs'
export const ANNOTATION_FORMAT = 'rb-annotations/v2'
export const LEGACY_ANNOTATION_FORMAT = 'rb-annotations/v1'
export const LEGACY_OBJECT_REQUIREMENTS = { schemaVersion: 3, capabilitiesVersion: 7, capabilities: ['annotation_completion', 'image_read'], targetTypes: ['text', 'image', 'table', 'cell'] }
export const ANNOTATION_REQUIREMENTS = { schemaVersion: 3, capabilitiesVersion: 8, capabilities: ['annotation_completion', 'image_read', 'node_annotations'], targetTypes: ['text', 'node', 'image', 'table', 'cell'] }
export const MAX_ANNOTATIONS = 30
export const MAX_REQUEST_BYTES = 1024 * 1024
const points = value => Array.from(value)

export function extractAnnotationBlocks(document, registry = annotationNodeCapabilities) {
  const blocks = []
  const ids = new Set()
  let section = ''
  let order = 0
  function visit(node, topLevelId) {
    const text = nodeAnnotationCapability(node.type, registry)?.text
    if (text === 'block') {
      const id = node.attrs?.diffId
      if (!id || !topLevelId || ids.has(id)) throw new Error('正文块缺少唯一定位标识，请等待正文同步后重试。')
      ids.add(id)
      if ((node.content ?? []).some(child => child.type !== 'text' && child.type !== 'hardBreak')) { order++; return }
      const text = (node.content ?? []).map(child => child.type === 'hardBreak' ? '\n' : child.text ?? '').join('')
      if (node.type === 'heading') section = text
      blocks.push({ blockId: id, topLevelId, blockType: node.type, text, section, order: order++ })
    } else if (text === 'children') {
      for (const child of node.content ?? []) visit(child, node.type === 'doc' ? child.attrs?.diffId : topLevelId)
    } else order++
  }
  visit(document)
  return blocks
}

export function anchorSegment(block, start, end) {
  const chars = points(block.text)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > chars.length) throw new Error('标注范围无效。')
  return { blockId: block.blockId, topLevelId: block.topLevelId, blockType: block.blockType,
    start, end, quote: chars.slice(start, end).join(''), prefix: chars.slice(Math.max(0, start - 24), start).join(''),
    suffix: chars.slice(end, end + 24).join(''), blockText: block.text }
}

function string(value, max, empty = false) { return typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) }
export function validateAnnotation(note, registry = annotationNodeCapabilities) {
  if (note?.target && note.target.type !== 'text') {
    const target = note.target
    if (target.type === 'node') {
      if (!string(note.id, 100) || !string(note.comment, 2000, true) || !string(note.quote, 512, true) || !string(note.section, 1000, true)
        || !Array.isArray(note.segments) || note.segments.length) throw new Error('节点标注内容无效。')
      validateNodeTarget(target, registry)
      return note
    }
    if (!string(note.id, 100) || !string(note.comment, 2000, true) || !string(note.quote, 512, true) || !string(note.section, 1000, true)
      || !Array.isArray(note.segments) || note.segments.length || !['image', 'table', 'cell'].includes(target.type)
      || !string(target.blockId, 100) || !string(target.topLevelId, 100) || !/^[a-f0-9]{64}$/.test(target.signature)
      || typeof target.summary !== 'string' || points(target.summary).length > 256) throw new Error('对象标注内容或定位信息无效。')
    const allowed = ['type', 'blockId', 'topLevelId', 'signature', 'summary', ...(target.type === 'image' ? ['src'] : target.type === 'cell' ? ['tableId', 'nodeType', 'range'] : [])]
    if (Object.keys(target).some(key => !allowed.includes(key))) throw new Error('对象标注包含不支持的定位字段。')
    if (target.type === 'image' && !string(target.src, 4096)) throw new Error('图片资源引用无效。')
    if (target.type === 'cell' && (!string(target.tableId, 100) || !['tableCell', 'tableHeader'].includes(target.nodeType)
      || !target.range || Object.keys(target.range).sort().join(',') !== 'colspan,column,row,rowspan'
      || Object.values(target.range).some(value => !Number.isSafeInteger(value) || value < 1 || value > 100000))) throw new Error('单元格身份或合并范围无效。')
    return note
  }
  if (note?.target && (note.target.type !== 'text' || Object.keys(note.target).length !== 1)) throw new Error('文字标注目标无效。')
  if (!note || !string(note.id, 100) || !string(note.comment, 2000, true) || !string(note.quote, 12000) || !string(note.section, 1000, true)
    || !Array.isArray(note.segments) || !note.segments.length || note.segments.length > 100) throw new Error('标注内容无效或过长。')
  const ids = new Set()
  for (const segment of note.segments) {
    if (!segment || !string(segment.blockId, 100) || !string(segment.topLevelId, 100) || nodeAnnotationCapability(segment.blockType, registry)?.text !== 'block'
      || !string(segment.blockText, 100000) || !string(segment.quote, 12000) || !string(segment.prefix, 100, true) || !string(segment.suffix, 100, true)
      || ids.has(segment.blockId)) throw new Error('标注定位信息无效。')
    ids.add(segment.blockId)
    const expected = anchorSegment({ ...segment, text: segment.blockText }, segment.start, segment.end)
    if (['quote', 'prefix', 'suffix'].some(key => expected[key] !== segment[key])) throw new Error('标注原文与范围不一致。')
  }
  if (note.quote !== note.segments.map(segment => segment.quote).join('\n')) throw new Error('标注原文不完整。')
  return note
}

export function resolveAnnotation(note, document, registry = annotationNodeCapabilities) {
  validateAnnotation(note, registry)
  if (note.target && note.target.type !== 'text') {
    try { return { id: note.id, segments: [], ...(note.target.type === 'node' ? resolveNodeTarget(note.target, document, registry) : resolveObjectTarget(note.target, document)) } }
    catch (error) { return { id: note.id, status: 'unresolved', segments: [], reason: error.message } }
  }
  const blocks = extractAnnotationBlocks(document, registry)
  const resolved = []
  let moved = false
  let lastIndex = -1
  let lastOrder = -1
  for (const segment of note.segments) {
    const index = blocks.findIndex(block => block.blockId === segment.blockId)
    const block = blocks[index]
    if (!block || block.topLevelId !== segment.topLevelId || block.blockType !== segment.blockType || index <= lastIndex) {
      return { id: note.id, status: 'unresolved', reason: '原文已删除、移动到其他结构或顺序已变化，请重新标注。', segments: [] }
    }
    // 跨块标注中间插入新段落时，不把新段落悄悄纳入用户选择。
    if (lastIndex >= 0 && block.order !== lastOrder + 1) return { id: note.id, status: 'unresolved', reason: '标注范围内存在新段落、空段落或不支持的内容，请分段重新标注。', segments: [] }
    lastIndex = index
    lastOrder = block.order
    if (block.text === segment.blockText) { resolved.push(anchorSegment(block, segment.start, segment.end)); continue }
    const candidates = []
    for (let offset = block.text.indexOf(segment.quote); offset >= 0; offset = block.text.indexOf(segment.quote, offset + 1)) {
      const after = offset + segment.quote.length
      const prefixMatches = segment.prefix ? block.text.slice(0, offset).endsWith(segment.prefix) : offset === 0
      const suffixMatches = segment.suffix ? block.text.slice(after).startsWith(segment.suffix) : after === block.text.length
      if (prefixMatches && suffixMatches) {
        const start = points(block.text.slice(0, offset)).length
        candidates.push({ start, end: start + points(segment.quote).length })
        if (candidates.length > 1) break
      }
    }
    if (candidates.length !== 1) return { id: note.id, status: 'unresolved', reason: candidates.length ? '有多个相同片段，无法唯一定位，请重新标注。' : '原文或相邻文字已变化，请重新标注。', segments: [] }
    moved = true
    resolved.push(anchorSegment(block, candidates[0].start, candidates[0].end))
  }
  return { id: note.id, status: moved ? 'moved' : 'exact', reason: '', segments: resolved }
}

export function validateAnnotationRequest(request, registry = annotationNodeCapabilities) {
  if (!request || ![ANNOTATION_FORMAT, LEGACY_ANNOTATION_FORMAT].includes(request.format) || request.source !== 'shared-draft'
    || !/^[23]:[a-f0-9]{64}$/.test(request.contentToken) || !string(request.createdAt, 40) || !Number.isFinite(Date.parse(request.createdAt))
    || !string(request.overall, 2000, true) || !string(request.document?.id, 100) || !string(request.document?.title, 1000, true)
    || !string(request.document?.key, 100) || !string(request.document?.origin, 300)) throw new Error('不支持的 AI 标注请求，请重新复制。')
  let url, origin
  try { url = new URL(request.document.url); origin = new URL(request.document.origin) } catch { throw new Error('标注文档地址无效。') }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== request.document.origin || url.origin !== origin.origin
    || url.username || url.password || url.search || url.hash || decodeURIComponent(url.pathname) !== `/requirements/${request.document.id}`) throw new Error('标注文档地址与身份不一致。')
  if (!Array.isArray(request.annotations) || !request.annotations.length || request.annotations.length > MAX_ANNOTATIONS) throw new Error('每次支持 1–30 条标注。')
  const ids = new Set()
  if (request.format === ANNOTATION_FORMAT && (![ANNOTATION_REQUIREMENTS, LEGACY_OBJECT_REQUIREMENTS].some(required => stableJson(request.requirements) === stableJson(required)) || !request.contentToken.startsWith('3:'))) {
    throw new Error('v2 标注需要匹配的 schema 3 与标注能力，请升级网页和 Skill 后重新复制。')
  }
  for (const note of request.annotations) {
    validateAnnotation(note, registry)
    if (note.target?.type === 'node' && request.requirements?.capabilitiesVersion !== 8) throw new Error('通用节点标注需要 capabilities 8 / node_annotations，不能降级执行。')
    if (request.format === ANNOTATION_FORMAT && !note.target) throw new Error('v2 标注必须显式声明目标类型。')
    if (request.format === LEGACY_ANNOTATION_FORMAT && note.target && note.target.type !== 'text') throw new Error('v1 只支持普通文字标注，请升级 Skill。')
    if (!note.comment.trim() || ids.has(note.id)) throw new Error('请填写每条标注的要求，并避免重复标注 ID。')
    ids.add(note.id)
  }
  if (request.completion !== undefined && (!Array.isArray(request.completion) || request.completion.length !== ids.size
    || request.completion.some((item, index) => item?.id !== request.annotations[index].id || !/^[a-f0-9]{64}$/.test(item?.fingerprint)))) {
    throw new Error('标注完成回执信息无效，请重新复制。')
  }
  if (new TextEncoder().encode(JSON.stringify(request)).length > MAX_REQUEST_BYTES) throw new Error('标注请求超过 1 MiB，请精简要求或分批处理；不会丢弃标注。')
  return request
}

export function formatAnnotationRequest(request, registry = annotationNodeCapabilities) {
  validateAnnotationRequest(request, registry)
  const json = JSON.stringify(request, null, 2).replace(/`/g, '\\u0060')
  if (new TextEncoder().encode(json).length > MAX_REQUEST_BYTES) throw new Error('完整标注 JSON 超过 1 MiB，请精简要求或分批处理。')
  return `$requirement-board\n\n\`\`\`rb-annotations\n${json}\n\`\`\``
}

// 使用复制前的本机标注计算身份，不能用重定位后的新范围覆盖它。
// 包含整体要求，保证用户在 Agent 处理期间修改要求后不会被旧回执清除。
export async function annotationFingerprint(note, overall, format = note.target ? ANNOTATION_FORMAT : LEGACY_ANNOTATION_FORMAT) {
  const legacy = [note.id, note.comment, note.quote, note.section, overall,
    note.segments.map(segment => [segment.blockId, segment.topLevelId, segment.blockType,
      segment.start, segment.end, segment.quote, segment.prefix, segment.suffix, segment.blockText])]
  const value = format === LEGACY_ANNOTATION_FORMAT ? legacy : [ANNOTATION_FORMAT, note.target ?? { type: 'text' }, ...legacy]
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(format === LEGACY_ANNOTATION_FORMAT ? JSON.stringify(value) : stableJson(value)))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function parseAnnotationRequest(text, registry = annotationNodeCapabilities) {
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES + 4096) throw new Error('标注请求文件过大。')
  const fences = [...text.matchAll(/^```rb-annotations\r?\n([\s\S]*?)^```\s*$/gm)]
  if (fences.length > 1) throw new Error('一次只能处理一个标注请求。')
  let request
  try { request = JSON.parse(fences.length === 1 ? fences[0][1] : text) } catch { throw new Error('未找到有效的 rb-annotations/v1 或 v2 请求。') }
  return validateAnnotationRequest(request, registry)
}

export function resolveAnnotationRequest(request, snapshot, origin, registry = annotationNodeCapabilities) {
  validateAnnotationRequest(request, registry)
  if (request.document.origin !== origin) throw new Error('标注不属于配置的站点。')
  if ((snapshot.requirementId ?? snapshot.id) !== request.document.id || snapshot.schemaVersion !== 3 || !snapshot.contentJson
    || !/^3:[a-f0-9]{64}$/.test(snapshot.contentToken) || (snapshot.siteOrigin && snapshot.siteOrigin !== origin)) throw new Error('请读取 schema 3 的完整最新快照；若服务端尚未升级，请先升级服务端。')
  const annotations = request.annotations.map(note => ({ ...resolveAnnotation(note, snapshot.contentJson, registry), comment: note.comment, quote: note.quote }))
  return { format: request.format, requirementId: request.document.id, contentToken: snapshot.contentToken,
    sourceChanged: snapshot.contentToken !== request.contentToken, ready: annotations.every(note => note.status !== 'unresolved'),
    overall: request.overall, annotations,
    topLevelIds: [...new Set(annotations.flatMap(note => note.target ? [note.target.topLevelId] : note.segments.map(segment => segment.topLevelId)))] }
}

export function assertAnnotationCapabilities(request, schema, registry = annotationNodeCapabilities) {
  validateAnnotationRequest(request, registry)
  const required = request.format === LEGACY_ANNOTATION_FORMAT ? LEGACY_OBJECT_REQUIREMENTS : request.requirements
  if (schema.schemaVersion !== 3 || !Number.isSafeInteger(schema.capabilitiesVersion) || schema.capabilitiesVersion < required.capabilitiesVersion
    || !required.capabilities.every(capability => schema.capabilities?.includes(capability))
    || !required.targetTypes.every(type => schema.annotationTargetTypes?.includes(type))
    || !schema.annotationFormats?.includes(request.format)) {
    throw new Error(`来源站点缺少标注能力（schema 3 / capabilities ${required.capabilitiesVersion}），请升级站点和 Skill 后重查；不能降级执行。`)
  }
  for (const note of request.annotations) {
    if (note.target?.type === 'node' && schema.annotationNodes?.[note.target.nodeType]?.version !== note.target.version) {
      throw new Error(`来源站点尚不支持 ${note.target.nodeType} 的标注能力版本 ${note.target.version}，请更新站点和 Skill 后重查。`)
    }
  }
}
