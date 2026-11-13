import { requireAppContext } from '../../utils/request-context'
import { sendAgentSkill } from '../../utils/send-agent-skill'

export default defineEventHandler(async event => {
  await requireAppContext(event)
  return sendAgentSkill(event)
})
