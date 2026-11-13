import { requireAgentContext } from '../../../../services/agent-tokens'

export default defineEventHandler(async event => {
  await requireAgentContext(event)
  throw createError({ statusCode: 410, message: 'AI 审核功能已移除，请更新 Requirement Board Skill 后直接编辑文档', data: { code: 'AGENT_REVIEW_REMOVED' } })
})
