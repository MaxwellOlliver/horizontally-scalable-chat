import { jwtVerify } from 'jose'

/**
 * Verifies an access-token JWT locally (shared HS256 secret with auth-service)
 * and returns the caller identity. Resource services authenticate mutations
 * this way — no DB lookup, no call back to the auth tier.
 */
export interface AuthenticatedUser {
  userId: string
}

export interface AccessTokenVerifier {
  /** Resolves the caller, or throws if the token is missing/invalid/expired. */
  verify(token: string): Promise<AuthenticatedUser>
}

/**
 * HS256 access-token verifier using the shared secret + issuer (the same
 * cross-service contract the gateway verifies against). The `sub` claim is the
 * caller's user id.
 */
export function createJwtAccessTokenVerifier(secret: string, issuer: string): AccessTokenVerifier {
  const key = new TextEncoder().encode(secret)
  return {
    async verify(token: string): Promise<AuthenticatedUser> {
      const { payload } = await jwtVerify(token, key, {
        issuer,
        algorithms: ['HS256'],
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('Access token is missing sub')
      }
      return { userId: payload.sub }
    },
  }
}
