import type { Session } from './types'

/**
 * The single source of truth for the auth session, outside React so the Axios
 * interceptors can read the access token and apply rotated tokens after a
 * refresh. React subscribes via `useSyncExternalStore` (see auth-context).
 *
 * Tokens live in localStorage so a reload stays signed in. That trades some XSS
 * exposure for a tokens-in-body API (auth §2.6 returns them in the response, not
 * an httpOnly cookie); acceptable for this study client.
 */
const STORAGE_KEY = 'relay.session'

let session: Session | null = readFromStorage()
const listeners = new Set<() => void>()

function readFromStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function persist() {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable (private mode) — stay in-memory only */
  }
}

function emit() {
  for (const listener of listeners) listener()
}

export const tokenStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Stable snapshot for useSyncExternalStore (ref changes only on mutation). */
  getSnapshot(): Session | null {
    return session
  },

  set(next: Session) {
    session = next
    persist()
    emit()
  },

  /** Apply rotated tokens after a refresh, keeping the existing profile. */
  updateTokens(accessToken: string, refreshToken: string) {
    if (!session) return
    session = { ...session, accessToken, refreshToken }
    persist()
    emit()
  },

  clear() {
    session = null
    persist()
    emit()
  },
}

// Cross-tab sync: a logout (or login) in one tab updates the others.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    session = readFromStorage()
    emit()
  })
}
