import type { AccountAccess } from '#shared/auth/access'
import { useState } from '#app'

export function useAccountAccessState() {
  return useState<AccountAccess | null>('account-access', () => null)
}
