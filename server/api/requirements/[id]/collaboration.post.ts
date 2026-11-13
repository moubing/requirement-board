import { z } from 'zod'
import { collaborationSnapshotSchema, collaborationSignature } from '../../../../shared/collaboration/document'
import { richTextDocumentSchema } from '../../../../shared/editor/validation'
import { requireAppContext } from '../../../utils/request-context'
import { initializeCollaboration } from '../../../services/collaboration'
import { currentNodeContributions } from '../../../services/node-contributions'
import { activeAgentLock } from '../../../services/agent-locks'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser } = await requireAppContext(event)
  const raw = await readRawBody(event)
  if (raw && Buffer.byteLength(raw) > 4 * 1024 * 1024) throw createError({ statusCode: 413, message: '正文过大' })
  let input: unknown
  try { input = raw ? JSON.parse(raw) : {} } catch { throw createError({ statusCode: 400, message: '协作初始化参数无效' }) }
  // 尚未初始化的旧文档/本机备份可缺少单元格 ID；仅初始化时由服务统一补齐。
  const initialSchema = collaborationSnapshotSchema.extend({ contentJson: richTextDocumentSchema })
  const body = z.object({ initial: initialSchema.optional() }).strict().safeParse(input)
  if (!body.success) throw createError({ statusCode: 400, message: '协作初始化参数无效' })
  const { record, initialized } = await initializeCollaboration(db, getRouterParam(event, 'id')!, projectId, body.data.initial)
  const active = await activeAgentLock(db, record.requirementId)
  setHeader(event, 'cache-control', 'no-store')
  return { state: Buffer.from(record.state).toString('base64'), initialized,
    schemaVersion: record.schemaVersion,
    editEpoch: record.editEpoch,
    agentLock: active?.view ?? null,
    canRelease: Boolean(active && (active.user.id === currentUserId || currentUser.role === 'admin')),
    attribution: await currentNodeContributions(db, record), attributionSequence: record.attributionSequence,
    signature: await collaborationSignature(record), updatedAt: record.updatedAt.toISOString() }
})
