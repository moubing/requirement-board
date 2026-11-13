import { requireAgentContext } from '../../../../services/agent-tokens'
import { searchAgentDocuments } from '../../../../services/agent-reading'
import { parseAgentQuery } from '../../../../utils/agent-query'
import { requirementPageQuerySchema } from '../../../../../shared/requirements/query'
export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAgentContext(event)
  setHeader(event, 'cache-control', 'no-store')
  const raw = getQuery(event)
  const query = parseAgentQuery(requirementPageQuerySchema, raw)
  // 旧 CLI 只发送 q，保留其数组形状；新 CLI 始终显式发送 page/pageSize。
  const legacy = Object.keys(raw).every(key => key === 'q')
  const result = await searchAgentDocuments(db, projectId, currentUserId, legacy ? { ...query, pageSize: 100 } : query)
  if (!legacy) return result
  return result.items.map(({ id, key, title, documentType, status, priority, updatedAt, assigneeIds, assignees }) =>
    ({ id, key, title, documentType, statusId: status.id, priority, updatedAt, assigneeIds, assignees }))
})
