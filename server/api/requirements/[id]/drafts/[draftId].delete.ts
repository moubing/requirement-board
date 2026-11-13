import { draftCloseSchema, draftIdSchema } from '../../../../../shared/drafts/validation'
import { lockAssetReferences } from '../../../../services/asset-references'
import { finishDraft, lockDraft, ownedDraft, requireDraftRequirement } from '../../../../services/requirement-drafts'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, currentUserId, projectId } = await requireAppContext(event)
  const requirementId = getRouterParam(event, 'id')!
  const draftId = draftIdSchema.safeParse(getRouterParam(event, 'draftId'))
  const input = draftCloseSchema.safeParse(await readBody(event))
  if (!draftId.success || !input.success) throw createError({ statusCode: 400, message: '草稿参数无效' })
  await db.transaction(async tx => {
    await lockAssetReferences(tx)
    await lockDraft(tx, draftId.data)
    await requireDraftRequirement(tx, requirementId, projectId)
    const draft = await ownedDraft(tx, draftId.data, requirementId, currentUserId)
    if (!draft) throw createError({ statusCode: 404, message: '草稿不存在' })
    if (draft.closedAt) return
    await finishDraft(tx, draft)
  })
  return { ok: true }
})
