import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

type InvitationIdentity = { id: string; projectId: string }

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

// 用服务端密钥和不可复用的邀请 ID 派生凭证，数据库仍只保存摘要。
// 保留版本和用途前缀，避免与同一密钥的其他用途混用。
export function deriveInvitationToken(invitation: InvitationIdentity, secret: string) {
  return createHmac('sha256', secret)
    .update(JSON.stringify(['requirement-board:invitation:v1', invitation.projectId, invitation.id]))
    .digest('base64url')
}

export function recoverInvitationToken(invitation: InvitationIdentity & { tokenHash: string }, secret: string) {
  const token = deriveInvitationToken(invitation, secret)
  if (!/^[a-f0-9]{64}$/.test(invitation.tokenHash)) return null
  const matches = timingSafeEqual(Buffer.from(hashInvitationToken(token), 'hex'), Buffer.from(invitation.tokenHash, 'hex'))
  // 旧版随机凭证或更换密钥后的凭证无法还原，不能返回一个无效链接。
  return matches ? token : null
}
