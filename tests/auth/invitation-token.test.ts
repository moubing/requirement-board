import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveInvitationToken, hashInvitationToken, recoverInvitationToken } from '../../server/services/invitation-token'

const secret = 'invitation-test-secret-never-used-outside-tests'
const identity = { id: 'invite_test', projectId: 'project_test' }

describe('recoverable invitation tokens', () => {
  it('recovers the original token from the stored identity and hash without persisting the token', () => {
    const token = deriveInvitationToken(identity, secret)
    const stored = JSON.parse(JSON.stringify({ ...identity, tokenHash: hashInvitationToken(token) }))
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(stored.tokenHash).not.toContain(token)
    expect(recoverInvitationToken(stored, secret)).toBe(token)
  })

  it('cannot recover a link with another invitation, project or server secret', () => {
    const stored = { ...identity, tokenHash: hashInvitationToken(deriveInvitationToken(identity, secret)) }
    expect(recoverInvitationToken({ ...stored, id: 'invite_other' }, secret)).toBeNull()
    expect(recoverInvitationToken({ ...stored, projectId: 'project_other' }, secret)).toBeNull()
    expect(recoverInvitationToken(stored, 'rotated-test-secret')).toBeNull()
  })

  it('does not invent a replacement for a legacy random token', () => {
    const token = randomBytes(32).toString('base64url')
    expect(recoverInvitationToken({ ...identity, tokenHash: hashInvitationToken(token) }, secret)).toBeNull()
  })
})
