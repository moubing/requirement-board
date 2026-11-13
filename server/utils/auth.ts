import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { APIError } from 'better-auth/api'
import { betterAuth } from 'better-auth'
import { admin, username } from 'better-auth/plugins'
import { nanoid } from 'nanoid'

import { useDatabase } from '../db/client'
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authVerifications,
  projectAccessRequests,
  users,
} from '../db/schema'
import { writeAudit } from '../services/audit'
import { resolveAuthRuntimeConfig } from './auth-config'
import { DEFAULT_PROJECT_ID } from './current-user'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy'

let cachedAuth: ReturnType<typeof createAuth> | undefined

function createAuth() {
  const db = useDatabase()
  const config = resolveAuthRuntimeConfig()

  return betterAuth({
    appName: 'Requirement Board',
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        rateLimit: authRateLimits,
      },
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        immutableUsername: true,
      }),
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
    ],
    user: {
      additionalFields: {
        avatarColor: {
          type: 'string',
          required: true,
          defaultValue: '#2b6ef3',
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: config.cookiePrefix,
      ipAddress: {
        ipAddressHeaders: ['x-real-ip'],
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!user.name.trim() || user.name.trim().length > 80 || user.email.length > 160) {
              throw new APIError('BAD_REQUEST', { message: '姓名限 1–80 个字符，邮箱最多 160 个字符' })
            }
            return { data: { ...user, name: user.name.trim() } }
          },
          after: async (user) => {
            // Better Auth 在凭证事务提交后运行 after 钩子。
            await db.transaction(async (tx) => {
              const [request] = await tx.insert(projectAccessRequests)
                .values({ id: `request_${nanoid(12)}`, projectId: DEFAULT_PROJECT_ID, userId: user.id })
                .onConflictDoNothing().returning()
              if (request) await writeAudit(tx, {
                projectId: DEFAULT_PROJECT_ID, actorId: user.id,
                subjectUserId: user.id, targetId: request.id, action: 'request.submit', detail: { source: 'registration' },
              })
            })
          },
        },
        update: {
          before: async (user) => {
            if (user.name !== undefined && (!user.name.trim() || user.name.trim().length > 80)) {
              throw new APIError('BAD_REQUEST', { message: '姓名限 1–80 个字符' })
            }
          },
        },
      },
    },
  })
}

export function useAuth() {
  cachedAuth ??= createAuth()
  return cachedAuth
}
