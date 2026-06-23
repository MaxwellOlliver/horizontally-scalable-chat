import { decodeJwt } from './jwt'
import { tokenStore } from './token-store'
import { refreshTokens } from './auth-api'

// One in-flight refresh shared by the HTTP client (on 401) and the WebSocket
// (before connecting), so concurrent callers never rotate the token pair twice.
let refreshing: Promise<string> | null = null

/** Rotate the token pair and return the new access token. Single-flight. */
export function refreshAccessToken(): Promise<string> {
  const session = tokenStore.getSnapshot()
  if (!session?.refreshToken) return Promise.reject(new Error('no refresh token'))
  refreshing ??= refreshTokens(session.refreshToken)
    .then((pair) => {
      tokenStore.updateTokens(pair.accessToken, pair.refreshToken)
      return pair.accessToken
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

const EXPIRY_SKEW_MS = 30_000

/**
 * A currently-valid access token — refreshing first if it's expired or about to
 * expire. Returns null when logged out (or when refresh fails, which also clears
 * the session so the route guard sends the user to login). Used by the socket,
 * which must present a fresh token on every (re)connect (auth AC-C2).
 */
export async function ensureAccessToken(): Promise<string | null> {
  const session = tokenStore.getSnapshot()
  if (!session) return null
  const exp = decodeJwt(session.accessToken)?.exp
  if (exp && exp * 1000 - Date.now() > EXPIRY_SKEW_MS) {
    return session.accessToken
  }
  try {
    return await refreshAccessToken()
  } catch {
    tokenStore.clear()
    return null
  }
}
