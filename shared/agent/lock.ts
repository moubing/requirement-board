export const AGENT_LOCK_DURATION_MS = 30 * 60 * 1000

export interface AgentLockDto {
  snapshotId: string
  userId: string
  userName: string
  acquiredAt: string
  expiresAt: string
  suggestionId: string | null
}
