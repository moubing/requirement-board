import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const loopbackHosts = ['localhost', '127.0.0.1', '[::1]']

export function localDevAuthEnvironment(listenerUrl: string, rootDir: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'development') return null

  const listener = new URL(listenerUrl)
  if (!['http:', 'https:'].includes(listener.protocol)
    || ![...loopbackHosts, '0.0.0.0', '[::]'].includes(listener.hostname)) return null

  // 自定义域名/反向代理仍使用显式认证配置；非法配置交由原校验报告。
  const configuredUrl = env.BETTER_AUTH_URL?.trim()
  if (configuredUrl) {
    let configured: URL
    try { configured = new URL(configuredUrl) } catch { return null }
    if (!loopbackHosts.includes(configured.hostname) || !['http:', 'https:'].includes(configured.protocol)
      || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) return null
  }

  const host = loopbackHosts.includes(listener.hostname) ? listener.hostname : 'localhost'
  const port = listener.port || (listener.protocol === 'https:' ? '443' : '80')
  const origin = (hostname: string) => new URL(`${listener.protocol}//${hostname}:${port}`).origin
  const workspaceId = createHash('sha256').update(resolve(rootDir)).digest('hex').slice(0, 10)

  return {
    BETTER_AUTH_URL: origin(host),
    BETTER_AUTH_TRUSTED_ORIGINS: loopbackHosts.map(origin).join(','),
    BETTER_AUTH_COOKIE_PREFIX: `rb-dev-${workspaceId}-${port}`,
  }
}
