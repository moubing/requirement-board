import { sendAgentSkill } from '../../utils/send-agent-skill'

// 只分发通用安装包；/agent/v1 下的业务 API 仍使用 Bearer 认证。
export default defineEventHandler(sendAgentSkill)
