export interface AppAuthSession {
  user: {
    id: string
    name: string
    email: string
    username?: string | null
    displayUsername?: string | null
    role?: string | null
  }
}

export function useAuthSessionState() {
  return useState<AppAuthSession | null>('app-auth-session', () => null)
}
