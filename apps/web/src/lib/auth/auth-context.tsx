import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { tokenStore } from './token-store'
import { decodeJwt } from './jwt'
import { loginUser, logoutUser, registerUser } from './auth-api'
import type { AuthContextValue, Profile, Session } from './types'

const AuthContext = createContext<AuthContextValue | null>(null)

function sessionFrom(accessToken: string, refreshToken: string, extra: Omit<Profile, 'id'>): Session {
  const id = decodeJwt(accessToken)?.sub ?? 'unknown'
  return { accessToken, refreshToken, profile: { id, ...extra } }
}

/**
 * Owns the reactive view of the auth session. State lives in the external
 * tokenStore (shared with the Axios interceptors); this mirrors it into React
 * and exposes the login/register/logout actions the screens call.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(
    tokenStore.subscribe,
    tokenStore.getSnapshot,
    tokenStore.getSnapshot,
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: session !== null,
      user: session?.profile ?? null,
      async login(email, password) {
        const pair = await loginUser({ email, password })
        tokenStore.set(sessionFrom(pair.accessToken, pair.refreshToken, { email }))
      },
      async register(email, password, displayName) {
        await registerUser({ email, password, displayName })
        const pair = await loginUser({ email, password })
        tokenStore.set(sessionFrom(pair.accessToken, pair.refreshToken, { email, displayName }))
      },
      async logout() {
        const current = tokenStore.getSnapshot()
        tokenStore.clear()
        if (current) {
          // Best-effort: revoke the refresh family server-side (auth AC-O1).
          await logoutUser(current.refreshToken).catch(() => {})
        }
      },
    }),
    [session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
