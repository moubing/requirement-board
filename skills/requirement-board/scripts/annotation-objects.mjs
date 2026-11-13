// 无运行时依赖，供浏览器和下载的 Skill 使用同一套对象身份与内容核验。
import { annotationNodeCapabilities, nodeAnnotationCapability, tableCellRanges } from './annotation-node-capabilities.mjs'
export { tableCellRanges } from './annotation-node-capabilities.mjs'
const cellTypes = new Set(['tableCell', 'tableHeader'])
const points = value => Array.from(value)
export const objectSummary = value => points(value).slice(0, 256).join('')
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

// 同步 SHA-256：定位、事务保护和几何测量不能等待异步 Web Crypto。
export function sha256(text) {
  const bytes = new TextEncoder().encode(text)
  const size = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new DataView(new ArrayBuffer(size))
  bytes.forEach((byte, index) => data.setUint8(index, byte))
  data.setUint8(bytes.length, 128)
  data.setUint32(size - 4, bytes.length * 8)
  const initial = [], constants = []
  for (let candidate = 2; constants.length < 64; candidate++) {
    let prime = true
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) { prime = false; break }
    if (prime) {
      if (initial.length < 8) initial.push((Math.sqrt(candidate) % 1 * 0x100000000) | 0)
      constants.push((Math.cbrt(candidate) % 1 * 0x100000000) | 0)
    }
  }
  const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits))
  const words = new Int32Array(64)
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) words[i] = data.getInt32(offset + i * 4)
      else {
        const a = words[i - 15], b = words[i - 2]
        words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))
      }
    }
    let [a, b, c, d, e, f, g, h] = initial
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, index) => { initial[index] = (initial[index] + value) | 0 })
  }
  return initial.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

function semanticNode(node) {
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key, value]) => value !== null && value !== undefined
    && key !== 'diffId' && !(node.type === 'image' && ['width', 'height', 'align'].includes(key))
    && !(cellTypes.has(node.type) && key === 'colwidth')))
  if (cellTypes.has(node.type)) { attrs.colspan ??= 1; attrs.rowspan ??= 1 }
  const result = { type: node.type }
  if (Object.keys(attrs).length) result.attrs = attrs
  if (node.text !== undefined) result.text = node.text
  if (node.marks?.length) result.marks = node.marks.map(mark => ({ type: mark.type,
    ...Object.keys(mark.attrs ?? {}).length ? { attrs: mark.attrs } : {} })).sort((a, b) => compare(stableJson(a), stableJson(b)))
  if (node.content?.length) result.content = node.content.map(semanticNode)
  return result
}
export function objectContentSignature(node) { return sha256(stableJson(semanticNode(node))) }

function nodeText(node) {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const text = (node.content ?? []).map(nodeText).join(['table', 'tableRow', 'tableCell', 'tableHeader'].includes(node.type) ? '\n' : '')
  return text || (node.type === 'image' ? node.attrs?.alt || node.attrs?.title || '' : '')
}

function nodeSemantics(node, registry) {
  const capability = nodeAnnotationCapability(node.type, registry)
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key, value]) => value != null
    && key !== 'diffId' && !capability?.ignoredAttrs?.includes(key)))
  for (const [key, value] of Object.entries(capability?.defaultAttrs ?? {})) attrs[key] ??= value
  const result = { type: node.type }
  if (Object.keys(attrs).length) result.attrs = attrs
  if (node.text !== undefined) result.text = node.text
  if (node.marks?.length) result.marks = node.marks.map(mark => ({ type: mark.type,
    ...Object.keys(mark.attrs ?? {}).length ? { attrs: mark.attrs } : {} })).sort((a, b) => compare(stableJson(a), stableJson(b)))
  if (node.content?.length) result.content = node.content.map(child => nodeSemantics(child, registry))
  return result
}

export function nodeContentSignature(node, registry = annotationNodeCapabilities) { return sha256(stableJson(nodeSemantics(node, registry))) }

function summaryText(node, registry) {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const capability = nodeAnnotationCapability(node.type, registry)
  const inline = (node.content ?? []).every(child => child.type === 'text' || child.type === 'hardBreak')
  return (node.content ?? []).map(child => summaryText(child, registry)).filter(Boolean).join(inline ? '' : '\n')
    || capability?.summaryAttrs?.map(key => node.attrs?.[key]).find(value => typeof value === 'string' && value) || ''
}

/** 全篇检查身份，但只对本次目标计算摘要/签名；适配器不接管遍历和定位。 */
export function annotationNodes(document, select = () => true, registry = annotationNodeCapabilities) {
  const objects = [], ids = new Set(), contextCache = new Map()
  function visit(node, topLevelId, ancestors) {
    const blockId = node.attrs?.diffId
    if (blockId) {
      if (ids.has(blockId)) throw new Error('正文包含重复身份，请等待同步后重试。')
      ids.add(blockId)
    }
    const capability = nodeAnnotationCapability(node.type, registry)?.object
    if (capability && select(node.type, blockId)) {
      if (!blockId || !topLevelId) throw new Error('节点缺少稳定身份，请等待正文同步后重试。')
      const context = capability.context?.(node, ancestors, contextCache)
      const target = { type: 'node', nodeType: node.type, version: capability.version, blockId, topLevelId,
        signature: nodeContentSignature(node, registry), summary: objectSummary(summaryText(node, registry)), ...(context === undefined ? {} : { context }) }
      validateNodeTarget(target, registry)
      objects.push({ node, target })
    }
    for (const child of node.content ?? []) visit(child, node.type === 'doc' ? child.attrs?.diffId : topLevelId, [...ancestors, node])
  }
  visit(document, undefined, [])
  return objects
}

export function validateNodeTarget(target, registry = annotationNodeCapabilities) {
  const capability = nodeAnnotationCapability(target.nodeType, registry)?.object
  if (!capability || target.version !== capability.version) throw new Error(`尚不支持该节点的标注能力（${target.nodeType ?? '未知节点'}），请更新 Skill/网页后重试。`)
  const allowed = ['type', 'nodeType', 'version', 'blockId', 'topLevelId', 'signature', 'summary', 'context']
  if (target.type !== 'node' || Object.keys(target).some(key => !allowed.includes(key))
    || ![target.blockId, target.topLevelId].every(value => typeof value === 'string' && value.trim() && value.length <= 100)
    || !/^[a-f0-9]{64}$/.test(target.signature) || typeof target.summary !== 'string' || points(target.summary).length > 256
    || (capability.validateContext ? !capability.validateContext(target.context) : target.context !== undefined)) throw new Error('节点标注身份或上下文无效。')
  return target
}

export function captureNodeTarget(document, blockId, registry = annotationNodeCapabilities) {
  const [object] = annotationNodes(document, (_type, id) => id === blockId, registry)
  if (!object) throw new Error('本次选择的节点已不存在或未开放标注，请重新打开菜单。')
  return object.target
}

export function resolveNodeTarget(target, document, registry = annotationNodeCapabilities) {
  validateNodeTarget(target, registry)
  const [object] = annotationNodes(document, (type, id) => type === target.nodeType && id === target.blockId, registry)
  if (!object) return { status: 'unresolved', reason: '节点已删除、类型或身份已变化，请重新标注。' }
  const current = object.target, capability = nodeAnnotationCapability(target.nodeType, registry).object
  if (capability.sameIdentity && !capability.sameIdentity(target.context, current.context)) {
    return { status: 'unresolved', reason: capability.identityError ?? '节点资源或所属对象已变化，请重新标注。' }
  }
  if (current.signature !== target.signature) return { status: 'unresolved', reason: '节点内容、格式或属性已变化，请重新标注。' }
  return { status: stableJson(current.context) === stableJson(target.context) && current.topLevelId === target.topLevelId ? 'exact' : 'moved', reason: '', target: current }
}

// v2 首版对象格式保持原签名和字段，不能在加载/定位时改写未消费的回执依据。
function legacyTarget(target, node) {
  const base = { blockId: target.blockId, topLevelId: target.topLevelId, signature: objectContentSignature(node), summary: objectSummary(nodeText(node)) }
  if (target.nodeType === 'image') return { type: 'image', ...base, src: target.context.src }
  if (target.nodeType === 'table') return { type: 'table', ...base }
  return { type: 'cell', ...base, tableId: target.context.tableId, nodeType: target.nodeType, range: target.context.range }
}

export function annotationObjects(document, select = () => true) {
  return annotationNodes(document, (nodeType, id) => {
    const type = nodeType === 'image' ? 'image' : nodeType === 'table' ? 'table' : cellTypes.has(nodeType) ? 'cell' : undefined
    return type && select(type, id)
  }).map(({ node, target }) => ({ node, target: legacyTarget(target, node) }))
}

export function captureObjectTarget(document, type, blockId) {
  const [object] = annotationObjects(document, (kind, id) => kind === type && id === blockId)
  if (!object) throw new Error('本次选择的对象已不存在，请重新打开菜单。')
  return object.target
}

export function resolveObjectTarget(target, document) {
  const [object] = annotationObjects(document, (kind, id) => kind === target.type && id === target.blockId)
  if (!object) return { status: 'unresolved', reason: '对象已删除或身份已变化，请重新标注。' }
  const current = object.target
  if (target.type === 'cell' && (current.tableId !== target.tableId || current.nodeType !== target.nodeType
    || current.range.rowspan !== target.range.rowspan || current.range.colspan !== target.range.colspan)) {
    return { status: 'unresolved', reason: '单元格所属表格、类型或合并范围已变化，请重新标注。' }
  }
  if (current.signature !== target.signature || (target.type === 'image' && current.src !== target.src)) {
    return { status: 'unresolved', reason: '对象内容、格式或图片说明已变化，请重新标注。' }
  }
  return { status: stableJson(current.range) === stableJson(target.range) && current.topLevelId === target.topLevelId ? 'exact' : 'moved', reason: '', target: current }
}

export function objectTargetNodeType(target) { return target.type === 'node' || target.type === 'cell' ? target.nodeType : target.type }

export function objectTargetPresentation(target, nested = false, registry = annotationNodeCapabilities) {
  const definition = nodeAnnotationCapability(objectTargetNodeType(target), registry)
  const capability = definition?.object
  const context = target.type === 'node' ? target.context : target.type === 'image' ? { src: target.src } : target.type === 'cell' ? { tableId: target.tableId, range: target.range } : undefined
  return { label: capability?.location?.(context) ?? definition?.label ?? '节点',
    title: capability?.location ? `${definition.label} · ${capability.location(context)}` : definition?.label ?? '节点',
    menu: capability?.menu?.(target, nested) ?? `标注${definition?.label ?? '节点'}`,
    description: capability?.location?.(context), thumbnail: capability?.thumbnail?.(context), dom: capability?.dom ?? {} }
}

export function objectTargetLabel(target) { return objectTargetPresentation(target).label }
