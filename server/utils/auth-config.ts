const DEVELOPMENT_AUTH_SECRET = 'requirement-board-development-secret-only'

interface AuthEnvironment {
  [key: string]: string | undefined
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_TRUSTED_ORIGINS?: string
  BETTER_AUTH_COOKIE_PREFIX?: string
}

export interface AuthRuntimeConfig {
  secret: string
  baseURL: string
  trustedOrigins: string[]
  cookiePrefix: string
}

function parseOrigin(value: string, variableName: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${variableName} must use HTTP or HTTPS`)
  }

  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`${variableName} must use HTTPS unless it points to a loopback address`)
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${variableName} must contain only an origin`)
  }

  return url.origin
}

export function resolveAuthRuntimeConfig(
  env: AuthEnvironment = process.env,
  nodeEnv = process.env.NODE_ENV ?? 'development',
): AuthRuntimeConfig {
  const isProduction = nodeEnv === 'production'
  const rawSecret = env.BETTER_AUTH_SECRET?.trim()
  const secret = rawSecret || (isProduction ? '' : DEVELOPMENT_AUTH_SECRET)

  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  }

  const rawBaseURL = env.BETTER_AUTH_URL?.trim()
  if (isProduction && !rawBaseURL) {
    throw new Error('BETTER_AUTH_URL is required in production')
  }
  const baseURL = parseOrigin(rawBaseURL || 'http://localhost:3000', 'BETTER_AUTH_URL')

  const cookiePrefix = env.BETTER_AUTH_COOKIE_PREFIX?.trim() || 'better-auth'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(cookiePrefix)) {
    throw new Error('BETTER_AUTH_COOKIE_PREFIX must contain 1–48 letters, digits, underscores or hyphens and start with a letter or digit')
  }

  const configuredOrigins = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, 'BETTER_AUTH_TRUSTED_ORIGINS'))

  return {
    secret,
    baseURL,
    cookiePrefix,
    trustedOrigins: [...new Set([baseURL, ...configuredOrigins])],
  }
}
