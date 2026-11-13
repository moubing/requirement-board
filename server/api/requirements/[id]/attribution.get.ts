import { eq } from 'drizzle-orm'
import { requireAppContext } from '../../../utils/request-context'
import { requireDraftRequirement } from '../../../services/requirement-drafts'
import { currentNodeContributions } from '../../../services/node-contributions'
import { requirementCollaborationDocuments } from '../../../db/schema'

export default defineEventHandler(async event => {
  const { db, projectId } = await requireAppContext(event)
  const id = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, id, projectId)
  const record = await db.query.requirementCollaborationDocuments.findFirst({ where: eq(requirementCollaborationDocuments.requirementId, id) })
  setHeader(event, 'cache-control', 'no-store')
  return { snapshot: record ? await currentNodeContributions(db, record) : null, sequence: record?.attributionSequence ?? 0 }
})
