import { authSessions } from '../db/schema'
import { useDatabase } from '../db/client'
import { resolveAuthRuntimeConfig } from '../utils/auth-config'

export default defineEventHandler(async () => {
  try {
    resolveAuthRuntimeConfig()
    await useDatabase().select({ id: authSessions.id }).from(authSessions).limit(1)
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service unavailable',
      cause: error,
    })
  }

  return { status: 'ok' }
})
