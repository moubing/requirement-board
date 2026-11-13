import { createError, readRawBody, type H3Event } from 'h3'
import { MAX_AGENT_DOCUMENT_BYTES, agentRequestSchema } from '../../shared/agent/suggestions'

export async function readAgentSuggestionInput(event: H3Event) {
  const raw = await readRawBody(event)
  if (!raw || Buffer.byteLength(raw) > MAX_AGENT_DOCUMENT_BYTES) throw createError({ statusCode: 413, message: '建议请求为空或超过 4 MiB' })
  let input: unknown
  try { input = JSON.parse(raw) } catch { throw createError({ statusCode: 400, message: '请求必须是 JSON' }) }
  const parsed = agentRequestSchema.safeParse(input)
  if (!parsed.success) throw createError({ statusCode: 422, message: '建议格式无效', data: { code: 'INVALID_INPUT', issues: parsed.error.issues } })
  return parsed.data
}
