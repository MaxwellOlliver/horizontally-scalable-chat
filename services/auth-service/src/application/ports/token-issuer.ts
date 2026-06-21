/**
 * Access-token port. Tokens are stateless JWTs verifiable without a DB lookup
 * (AC-L3, AC-W2). Claims follow the cross-language contract in spec §2.5:
 * `sub` (user UUIDv7), `iat`, `exp`, `jti`.
 */
export interface AccessTokenClaims {
  sub: string
  jti: string
  iat: number
  exp: number
}

export interface IssuedAccessToken {
  token: string
  /** Seconds until expiry — surfaced to clients as `expiresIn`. */
  expiresIn: number
}

export interface TokenIssuer {
  issueAccessToken(userId: string): Promise<IssuedAccessToken>
  verifyAccessToken(token: string): Promise<AccessTokenClaims>
}
