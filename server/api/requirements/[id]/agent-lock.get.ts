import { eq } from 'drizzle-orm'
import { requireAppContext } from '../../../utils/request-context'
import { activeAgentLock } from '../../../services/agent-locks'
import { requireDraftRequirement } from '../../../services/requirement-drafts'
import { requirementCollaborationDocuments } from '../../../db/schema'
import { exclusiveDocument, publishAgentLock } from '../../../services/collaboration'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId, currentUser } = await requireAppContext(event)
  const id = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, id, projectId)
  setHeader(event, 'cache-control', 'no-store')
  return exclusiveDocument(id, async () => {
    const record = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, id) })
    const active = await activeAgentLock(db, id)
    publishAgentLock(id, active?.view ?? null, record?.editEpoch ?? 0)
    return { lock: active?.view ?? null, editEpoch: record?.editEpoch ?? 0,
      canRelease: Boolean(active && (active.user.id === currentUserId || currentUser.role === 'admin')) }
  })
})
