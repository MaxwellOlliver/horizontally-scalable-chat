/** The access-token claims the client reads (the cross-service contract, auth §2.8). */
export interface AccessClaims {
  sub?: string
  exp?: number
  iat?: number
  jti?: string
}

/**
 * Decodes a JWT payload WITHOUT verifying it — the gateway/app verify the
 * signature; the client only needs `sub` (the user id) for display and `exp`
 * for proactive refresh. Returns null on anything malformed.
 */
export function decodeJwt(token: string): AccessClaims | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as AccessClaims
  } catch {
    return null
  }
}
