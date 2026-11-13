import { agentSetupGuide } from '../../utils/agent-setup-guide'

export default defineEventHandler(event => {
  const action = getQuery(event).action ?? 'install'
  if (action !== 'install' && action !== 'update' && action !== 'uninstall') throw createError({ statusCode: 400, message: '不支持的 Skill 操作' })
  let guide: string
  try { guide = agentSetupGuide(getRequestURL(event, { xForwardedHost: false }).origin, action) }
  catch { throw createError({ statusCode: 400, message: '安装链接的站点地址无效，请使用 HTTPS 或本机回环地址。' }) }
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'x-content-type-options', 'nosniff')
  return guide
})
