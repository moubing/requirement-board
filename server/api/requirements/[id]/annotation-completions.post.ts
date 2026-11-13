import { z } from 'zod'
import { annotationCompletionsSchema } from '../../../../shared/agent/annotation-completion'
import { requireAppContext } from '../../../utils/request-context'
import { requireDraftRequirement } from '../../../services/requirement-drafts'
import { readAnnotationCompletions } from '../../../services/annotation-completions'

// 只读取本人已成功执行的回执，不接受浏览器或 Agent 单独声明“清除标注”。
export default defineEventHandler(async event => {
  const { db, projectId, currentUserId } = await requireAppContext(event)
  const id = getRouterParam(event, 'id')!
  await requireDraftRequirement(db, id, projectId)
  const input = z.object({ annotations: annotationCompletionsSchema }).strict().safeParse(await readBody(event))
  if (!input.success) throw createError({ statusCode: 400, message: '标注回执查询无效' })
  const completed = await readAnnotationCompletions(db, { projectId, requirementId: id, userId: currentUserId }, input.data.annotations)
  setHeader(event, 'cache-control', 'no-store')
  return { completed }
})
