import { z } from 'zod'
import { annotationCompletionsSchema } from '../../../../../shared/agent/annotation-completion'
import { acknowledgeAnnotationCompletions } from '../../../../services/annotation-completions'
import { requireDraftRequirement } from '../../../../services/requirement-drafts'
import { requireAppContext } from '../../../../utils/request-context'

export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  const id = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, id, projectId)
  const input = z.object({ annotations: annotationCompletionsSchema }).strict().safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '标注回执确认无效' })
  await acknowledgeAnnotationCompletions(db, { projectId, requirementId: id, userId: currentUserId }, input.data.annotations)
  setHeader(event, 'cache-control', 'no-store')
  return { acknowledged: true }
})
