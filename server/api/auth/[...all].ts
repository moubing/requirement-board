import { toWebRequest } from 'h3'

import { useAuth } from '../../utils/auth'

const publicAuthPaths = new Set([
  '/sign-in/email', '/sign-in/username', '/sign-up/email',
  '/get-session', '/sign-out', '/change-password', '/update-user',
])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname.slice('/api/auth'.length)
  if (!publicAuthPaths.has(path)) {
    throw createError({ statusCode: 404, message: '认证接口不存在' })
  }
  return useAuth().handler(toWebRequest(event))
})
