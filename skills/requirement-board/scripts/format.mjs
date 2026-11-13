const label = version => version.id === 'draft' ? '当前草稿' : `v${version.version}`
const lines = (prefix, text) => String(text).split('\n').map(line => prefix + line).join('\n')
const inlineText = chunks => (chunks ?? []).map(chunk => chunk.value).join('')

export function formatDiff(result) {
  const output = [`${result.key}  ${label(result.base)} → ${label(result.target)}`,
    `新增 ${result.counts.inserted}，删除 ${result.counts.deleted}，修改 ${result.counts.modified}；标题${result.title.changed ? '已修改' : '未变化'}`]
  if (result.title.changed) output.push('@@ 标题 @@', lines('- ', result.title.before), lines('+ ', result.title.after))
  for (const block of result.blocks) {
    output.push(`\n@@ ${block.section.join(' / ') || '正文'} [${block.after?.id ?? block.before?.id}] @@`)
    if (block.before) output.push(lines('- ', block.before.text))
    if (block.after) output.push(lines('+ ', block.after.text))
    if (block.attributesChanged) output.push(`属性: ${JSON.stringify(block.before.node.attrs)} → ${JSON.stringify(block.after.node.attrs)}`)
    if (JSON.stringify(block.before?.list) !== JSON.stringify(block.after?.list)) output.push(`列表: ${JSON.stringify(block.before?.list ?? null)} → ${JSON.stringify(block.after?.list ?? null)}`)
    for (const change of block.formatChanges) output.push(`格式 ${JSON.stringify(change.text)}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`)
    if (block.after?.type === 'image' || block.before?.type === 'image') output.push(`图片: ${block.before?.node.attrs?.src ?? '无'} → ${block.after?.node.attrs?.src ?? '无'}`)
    for (const cell of block.cells ?? []) {
      output.push(`单元格 ${cell.row},${cell.column}:`, lines('- ', inlineText(cell.beforeChunks)), lines('+ ', inlineText(cell.afterChunks)))
      if (cell.before && cell.after && inlineText(cell.beforeChunks) === inlineText(cell.afterChunks)) output.push(`格式/结构: ${JSON.stringify(cell.before)} → ${JSON.stringify(cell.after)}`)
    }
  }
  if (result.nextOffset !== null) output.push(`\n尚有差异：--offset ${result.nextOffset} --comparison-token ${result.comparisonToken}（保持相同 --from/--to）`)
  return output.join('\n')
}

export function formatLog(versions) {
  return versions.map(v => `v${v.version}  ${v.id}\n保存人：${v.savedBy?.name ?? v.author?.name ?? '未记录'}  ${v.createdAt}\n${v.changeNote || '未填写版本说明'}`).join('\n\n')
}

function historyEvidence(entry) {
  // 兼容尚未更新的服务端；旧 introduced + lost 同样只是追溯中断。
  if (entry.status === 'tracking_lost' || entry.confidence === 'lost') return {
    label: '追溯到此中断',
    explanation: '已找到此版本的内容，但无法可靠对应到更早版本；不能据此确认首次出现、原作者或创作时间。',
    boundary: true,
  }
  if (entry.status === 'history_boundary') return {
    label: '达到历史查询上限', explanation: '更早版本未纳入查询，不能据此确认首次出现。', boundary: true,
  }
  if (entry.status === 'introduced') return {
    label: '最早可查记录', explanation: '此版本中已有这段内容；保存人和保存时间不能证明原作者或输入时间。', boundary: true,
  }
  return {
    label: `${entry.status === 'unchanged' ? '未变化' : '内容有变化'}（${entry.confidence === 'inferred' ? '推断定位' : '同一块定位'}）`,
    explanation: entry.confidence === 'inferred' ? '与更早版本的对应关系由相似内容推断，需要结合上下文核对。' : '',
    boundary: false,
  }
}

export function formatHistory(result) {
  const output = [`${result.key}  内容历史`, result.note]
  if (result.status === 'not_found') output.push('该版本未找到文本。可用 --at vN 在旧版本中定位。')
  else if (result.status === 'ambiguous') output.push(`找到 ${result.matchCount} 处，请使用 --block 和 --start 选择：`, ...result.matches.map(m => `${m.blockId}  start=${m.start}  ${m.context ?? m.text}`))
  else for (const entry of result.entries) {
    const evidence = historyEvidence(entry)
    output.push(`\n${entry.version === null ? '当前草稿' : `v${entry.version}`}  ${evidence.label}`,
      entry.explanation ?? evidence.explanation,
      `保存人：${entry.savedBy ?? '无'}  保存时间：${entry.savedAt ?? '尚未保存'}\n${entry.changeNote ?? ''}`)
    for (const segment of entry.segments) {
      if (historyEvidence(segment).boundary) output.push('此版本文本：', segment.after)
      else output.push(lines('- ', segment.before), lines('+ ', segment.after))
      output.push(`节点参与者：${segment.participants.map(p => p.name).join('、') || '未记录'}${segment.participantsUnknown ? '（记录不完整）' : ''}`)
      for (const chunk of segment.afterChunks) if (chunk.formatChange) output.push(`格式 ${JSON.stringify(chunk.value)}: ${JSON.stringify(chunk.formatChange)}`)
    }
  }
  if (result.truncated) output.push(`本次历史范围最多包含 200 个正式版本，最旧为 v${result.oldestExaminedVersion}；更早版本未纳入查询。`)
  return output.join('\n')
}
