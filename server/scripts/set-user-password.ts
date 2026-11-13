import { emitKeypressEvents, type Key } from 'node:readline'

import { hashPassword } from 'better-auth/crypto'
import { createLocalAccountIssuer } from 'better-auth/db'
import { eq, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { createDatabase } from '../db/client'
import { authAccounts, authSessions, users } from '../db/schema'
import {
  isPasswordLengthValid,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../utils/password-policy'

const DEFAULT_DEVELOPMENT_DATABASE_URL
  = 'postgres://requirement:requirement@localhost:5438/requirement_board'

function readHidden(prompt: string) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Password input requires an interactive terminal')
  }

  emitKeypressEvents(process.stdin)
  const wasPaused = process.stdin.isPaused()
  const wasRaw = process.stdin.isRaw
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdout.write(prompt)

  return new Promise<string>((resolve, reject) => {
    let value = ''

    const finish = (error?: Error) => {
      process.stdin.off('keypress', onKeypress)
      process.stdin.setRawMode(wasRaw)
      if (wasPaused) process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onKeypress = (text: string, key: Key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Password update cancelled'))
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish()
        return
      }
      if (key.name === 'backspace') {
        if (value) {
          value = value.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }
      if (key.ctrl || key.meta || !text || /[\u0000-\u001f\u007f]/.test(text)) return

      value += text
      process.stdout.write('*'.repeat(Array.from(text).length))
    }

    process.stdin.on('keypress', onKeypress)
  })
}

async function main() {
  const selector = process.argv[2]?.trim()
  if (!selector) {
    throw new Error('Usage: pnpm auth:set-password <user-id-or-username-or-email>')
  }

  const normalizedSelector = selector.toLowerCase()
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DEVELOPMENT_DATABASE_URL

  const { client, db } = createDatabase(databaseUrl)
  try {
    const user = await db.query.users.findFirst({
      where: or(
        eq(users.id, selector),
        eq(users.username, normalizedSelector),
        eq(users.email, normalizedSelector),
      ),
    })
    if (!user) throw new Error(`User not found: ${selector}`)
    if (user.banned) throw new Error(`User is disabled: ${user.id}`)

    const password = await readHidden('New password: ')
    if (!isPasswordLengthValid(password)) {
      throw new Error(`Password must contain ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`)
    }
    const confirmation = await readHidden('Confirm password: ')
    if (confirmation !== password) {
      throw new Error('Passwords do not match')
    }

    const passwordHash = await hashPassword(password)
    const issuer = createLocalAccountIssuer('credential')
    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .insert(authAccounts)
        .values({
          id: `auth_account_${nanoid(16)}`,
          issuer,
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        })
        .onConflictDoUpdate({
          target: [authAccounts.issuer, authAccounts.accountId],
          set: {
            providerId: 'credential',
            userId: user.id,
            password: passwordHash,
            updatedAt: now,
          },
        })

      await tx.delete(authSessions).where(eq(authSessions.userId, user.id))
    })

    process.stdout.write(`Password updated and existing sessions revoked for ${user.id}\n`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
